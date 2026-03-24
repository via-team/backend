const express = require('express');
const supabase = require('../../config/supabase');
const { aggregateVotes } = require('../../services/voteStats');

const router = express.Router();

/**
 * @swagger
 * /api/v1/routes/{id}:
 *   get:
 *     summary: Get specific route
 *     description: Get full route object including all GPS points and tags
 *     tags: [Routes]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Route ID
 *     responses:
 *       200:
 *         description: Full route object with route_points and tags
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   format: uuid
 *                 title:
 *                   type: string
 *                 description:
 *                   type: string
 *                 start_label:
 *                   type: string
 *                 end_label:
 *                   type: string
 *                 distance_meters:
 *                   type: integer
 *                 duration_seconds:
 *                   type: integer
 *                 start_time:
 *                   type: string
 *                   format: date-time
 *                 end_time:
 *                   type: string
 *                   format: date-time
 *                 avg_rating:
 *                   type: number
 *                   format: float
 *                 vote_count:
 *                   type: integer
 *                 tags:
 *                   type: array
 *                   items:
 *                     type: string
 *                 route_points:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       seq:
 *                         type: integer
 *                       lat:
 *                         type: number
 *                         format: float
 *                       lng:
 *                         type: number
 *                         format: float
 *                       accuracy_meters:
 *                         type: number
 *                         format: float
 *                       recorded_at:
 *                         type: string
 *                         format: date-time
 *                 created_at:
 *                   type: string
 *                   format: date-time
 *       404:
 *         description: Route not found
 *       500:
 *         description: Internal server error
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: route, error } = await supabase
      .from('routes')
      .select('*, route_tags(tags(name))')
      .eq('id', id)
      .eq('is_active', true)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({
          error: 'Route not found',
          message: `No active route found with id ${id}`,
        });
      }
      console.error('Error fetching route:', error);
      return res.status(500).json({
        error: 'Failed to fetch route',
        message: error.message,
      });
    }

    const [
      { data: votes, error: votesError },
      { data: rawPoints, error: pointsError },
    ] = await Promise.all([
      supabase.from('votes').select('vote_type').eq('route_id', id),
      supabase.rpc('get_route_points_with_coords', { p_route_id: id }),
    ]);

    let avgRating = 0;
    let voteCount = 0;
    if (!votesError && votes) {
      const agg = aggregateVotes(votes);
      avgRating = agg.avgRating;
      voteCount = agg.voteCount;
    }

    const tags = route.route_tags
      ? route.route_tags.map((rt) => rt.tags?.name).filter(Boolean)
      : [];

    let routePoints = [];
    if (!pointsError && rawPoints) {
      routePoints = rawPoints.map((p) => ({
        seq: p.sequence,
        lat: p.lat,
        lng: p.lng,
        accuracy_meters: p.accuracy_meters,
        recorded_at: p.recorded_at,
      }));
    } else if (pointsError) {
      console.error('Error fetching route points:', pointsError);
    }

    const { route_tags: _rt, ...routeFields } = route;

    res.json({
      ...routeFields,
      avg_rating: avgRating,
      vote_count: voteCount,
      tags,
      route_points: routePoints,
    });
  } catch (error) {
    console.error('Error in GET /routes/:id:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
});

module.exports = router;
