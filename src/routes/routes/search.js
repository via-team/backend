const express = require('express');
const supabase = require('../../config/supabase');
const { validateQuery } = require('../../middleware/validate');
const { SearchRoutesQuerySchema } = require('../../schemas/routes');
const { ROUTE_LIST_SELECT, enrichRoutesForList, fetchNearbyRouteIds } = require('../../services/routeList');

const router = express.Router();

/**
 * @swagger
 * /api/v1/routes/search:
 *   get:
 *     summary: Search routes by origin and destination
 *     description: >
 *       Returns routes whose start_point falls within from_radius metres of the origin and whose
 *       end_point falls within to_radius metres of the destination, sorted by duration_seconds
 *       ascending. When no route satisfies both proximity constraints, routes near the origin are
 *       returned as a fallback (search.matched will be false).
 *     tags: [Routes]
 *     parameters:
 *       - in: query
 *         name: from_lat
 *         required: true
 *         schema:
 *           type: number
 *           format: float
 *         description: Origin latitude
 *       - in: query
 *         name: from_lng
 *         required: true
 *         schema:
 *           type: number
 *           format: float
 *         description: Origin longitude
 *       - in: query
 *         name: to_lat
 *         required: true
 *         schema:
 *           type: number
 *           format: float
 *         description: Destination latitude
 *       - in: query
 *         name: to_lng
 *         required: true
 *         schema:
 *           type: number
 *           format: float
 *         description: Destination longitude
 *       - in: query
 *         name: from_radius
 *         schema:
 *           type: integer
 *           default: 300
 *         description: Metres from origin to match a route's start_point
 *       - in: query
 *         name: to_radius
 *         schema:
 *           type: integer
 *           default: 300
 *         description: Metres from destination to match a route's end_point
 *     responses:
 *       200:
 *         description: Matched routes sorted by duration_seconds ascending, or nearby fallback when no full match is found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                   description: Route objects sorted by duration_seconds ascending (full match) or by proximity to origin (fallback)
 *                 count:
 *                   type: integer
 *                   description: Number of routes in data
 *                 search:
 *                   type: object
 *                   properties:
 *                     from_lat:
 *                       type: number
 *                     from_lng:
 *                       type: number
 *                     to_lat:
 *                       type: number
 *                     to_lng:
 *                       type: number
 *                     from_radius:
 *                       type: integer
 *                     to_radius:
 *                       type: integer
 *                     matched:
 *                       type: boolean
 *                       description: true when routes satisfy both origin and destination constraints; false when results are a proximity-only fallback
 *       400:
 *         description: Invalid or missing query parameters
 *       500:
 *         description: Internal server error
 */
router.get('/search', validateQuery(SearchRoutesQuerySchema), async (req, res) => {
  try {
    const { from_lat, from_lng, to_lat, to_lng, from_radius, to_radius } = req.query;

    const searchMeta = { from_lat, from_lng, to_lat, to_lng, from_radius, to_radius };

    const { data: matchedIds, error: rpcError } = await supabase.rpc('get_routes_between', {
      p_from_lat: from_lat,
      p_from_lng: from_lng,
      p_to_lat: to_lat,
      p_to_lng: to_lng,
      p_from_radius: from_radius,
      p_to_radius: to_radius,
    });

    if (rpcError) {
      console.error('Error calling get_routes_between:', rpcError);
      return res.status(500).json({
        error: 'Failed to search routes',
        message: rpcError.message,
      });
    }

    if (matchedIds && matchedIds.length > 0) {
      const ids = matchedIds.map((r) => r.id);

      const { data: routes, error: routesError } = await supabase
        .from('routes')
        .select(`${ROUTE_LIST_SELECT}, duration_seconds`)
        .eq('is_active', true)
        .in('id', ids);

      if (routesError) {
        console.error('Error fetching matched routes:', routesError);
        return res.status(500).json({
          error: 'Failed to fetch matched routes',
          message: routesError.message,
        });
      }

      const sorted = (routes || []).sort(
        (a, b) => (a.duration_seconds ?? Infinity) - (b.duration_seconds ?? Infinity),
      );

      const { items } = await enrichRoutesForList(supabase, sorted);

      return res.json({
        data: items,
        count: items.length,
        search: { ...searchMeta, matched: true },
      });
    }

    const { ids: nearbyIds, error: nearbyError } = await fetchNearbyRouteIds(
      supabase,
      from_lat,
      from_lng,
      from_radius,
    );

    if (nearbyError) {
      console.error('Error calling get_routes_near for fallback:', nearbyError);
      return res.status(500).json({
        error: 'Failed to fetch nearby fallback routes',
        message: nearbyError.message,
      });
    }

    let nearbyItems = [];
    if (nearbyIds.length > 0) {
      const { data: nearbyRoutes, error: nearbyRoutesError } = await supabase
        .from('routes')
        .select(ROUTE_LIST_SELECT)
        .eq('is_active', true)
        .in('id', nearbyIds);

      if (nearbyRoutesError) {
        console.error('Error fetching nearby fallback routes:', nearbyRoutesError);
        return res.status(500).json({
          error: 'Failed to fetch nearby fallback routes',
          message: nearbyRoutesError.message,
        });
      }

      ({ items: nearbyItems } = await enrichRoutesForList(supabase, nearbyRoutes || []));
    }

    return res.json({
      data: nearbyItems,
      count: nearbyItems.length,
      search: { ...searchMeta, matched: false },
    });
  } catch (error) {
    console.error('Error in GET /routes/search:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
});

module.exports = router;
