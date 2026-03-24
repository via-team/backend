const express = require('express');
const supabase = require('../../config/supabase');
const { validateQuery } = require('../../middleware/validate');
const { ListRoutesQuerySchema } = require('../../schemas/routes');
const { ROUTE_LIST_SELECT, enrichRoutesForList } = require('../../services/routeList');
const { resolveLocationFilteredRouteIds } = require('../../services/routeLocation');

const router = express.Router();

/**
 * @swagger
 * /api/v1/routes:
 *   get:
 *     summary: Search and feed routes
 *     description: Search for routes by location, radius, tags, and sort order. When lat and lng are provided, results are filtered to routes whose start point falls within the given radius using PostGIS ST_DWithin.
 *     tags: [Routes]
 *     parameters:
 *       - in: query
 *         name: lat
 *         schema:
 *           type: number
 *           format: float
 *         description: User's current latitude — activates location-based filtering when combined with lng
 *       - in: query
 *         name: lng
 *         schema:
 *           type: number
 *           format: float
 *         description: User's current longitude — activates location-based filtering when combined with lat
 *       - in: query
 *         name: radius
 *         schema:
 *           type: integer
 *           default: 500
 *         description: Search radius in meters (used when lat and lng are provided)
 *       - in: query
 *         name: dest_lat
 *         schema:
 *           type: number
 *           format: float
 *         description: Destination latitude (accepted but not yet used for filtering)
 *       - in: query
 *         name: dest_lng
 *         schema:
 *           type: number
 *           format: float
 *         description: Destination longitude (accepted but not yet used for filtering)
 *       - in: query
 *         name: tags
 *         schema:
 *           type: string
 *         description: Comma-separated tag names to filter by (e.g., "shade,quiet")
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [popular, recent, efficient]
 *           default: recent
 *         description: Sort order
 *     responses:
 *       200:
 *         description: List of routes
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       title:
 *                         type: string
 *                       start_label:
 *                         type: string
 *                       distance_meters:
 *                         type: integer
 *                       avg_rating:
 *                         type: number
 *                         format: float
 *                       tags:
 *                         type: array
 *                         items:
 *                           type: string
 *                       preview_polyline:
 *                         type: string
 *       400:
 *         description: Invalid query parameters
 *       500:
 *         description: Internal server error
 */
router.get('/', validateQuery(ListRoutesQuerySchema), async (req, res) => {
  try {
    const { lat, lng, radius, tags, sort } = req.query;
    const parsedLat = lat ?? null;
    const parsedLng = lng ?? null;
    const parsedRadius = radius;

    const locationResult = await resolveLocationFilteredRouteIds(res, supabase, {
      parsedLat,
      parsedLng,
      parsedRadius,
      logContext: 'GET /routes',
      buildEmptyResponse: () => ({
        data: [],
        count: 0,
        filters: {
          lat: parsedLat,
          lng: parsedLng,
          radius: parsedRadius,
          tags: tags || null,
          sort,
        },
      }),
    });

    if (locationResult.handled) {
      return;
    }

    const { ids: locationFilteredIds } = locationResult;

    let query = supabase
      .from('routes')
      .select(ROUTE_LIST_SELECT)
      .eq('is_active', true);

    if (locationFilteredIds !== null) {
      query = query.in('id', locationFilteredIds);
    }

    const { data: routes, error: routesError } = await query.limit(100);

    if (routesError) {
      console.error('Error fetching routes:', routesError);
      return res.status(500).json({
        error: 'Failed to fetch routes',
        message: routesError.message,
      });
    }

    let transformedRoutes = (await enrichRoutesForList(supabase, routes)).items;

    if (tags) {
      const tagArray = tags.split(',').map((t) => t.trim().toLowerCase());
      transformedRoutes = transformedRoutes.filter((route) =>
        route.tags.some((tag) => tagArray.includes(tag.toLowerCase())),
      );
    }

    transformedRoutes.sort((a, b) => {
      switch (sort) {
        case 'popular':
          return b.vote_count - a.vote_count;
        case 'efficient':
          return a.distance_meters - b.distance_meters;
        case 'recent':
        default:
          return new Date(b.created_at) - new Date(a.created_at);
      }
    });

    const finalRoutes = transformedRoutes.map(
      ({ vote_count: _vc, ...route }) => route,
    );

    res.json({
      data: finalRoutes,
      count: finalRoutes.length,
      filters: {
        lat: parsedLat,
        lng: parsedLng,
        radius: parsedRadius,
        tags: tags || null,
        sort,
      },
    });
  } catch (error) {
    console.error('Error in GET /routes:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
});

module.exports = router;
