const express = require('express');
const supabase = require('../../config/supabase');
const { attachUserIfPresent, requireAuth } = require('../../middleware/auth');
const { validateBody } = require('../../middleware/validate');
const { UpdateRouteSchema } = require('../../schemas/routes');
const { aggregateVotes } = require('../../services/voteStats');

const router = express.Router();

function normaliseOptionalText(value) {
  return value === '' ? null : value;
}

/**
 * @swagger
 * /api/v1/routes/{id}:
 *   get:
 *     summary: Get specific route
 *     description: >
 *       Get the full route object including all GPS points and tags. The route creator can include
 *       an optional Bearer token to also receive their private `notes`; everyone else receives
 *       `notes: null`.
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
 *                 notes:
 *                   type: string
 *                   nullable: true
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
router.get('/:id', attachUserIfPresent, async (req, res) => {
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

    const { route_tags: _rt, notes: routeNotes, ...routeFields } = route;
    const notes = route.creator_id === req.user?.id ? routeNotes : null;

    res.json({
      ...routeFields,
      notes: notes ?? null,
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

/**
 * @swagger
 * /api/v1/routes/{id}:
 *   patch:
 *     summary: Update a route's editable fields
 *     description: >
 *       Route creators can update their own `title`, public `description`, and private `notes`.
 *       At least one field must be provided. Empty strings for `description` or `notes` are stored
 *       as `null`.
 *     tags: [Routes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Route ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *                 example: "Quieter walk to GDC"
 *               description:
 *                 type: string
 *                 nullable: true
 *                 example: "Cuts behind the library and avoids Speedway."
 *               notes:
 *                 type: string
 *                 nullable: true
 *                 example: "Best before 9am. East entrance is usually unlocked."
 *     responses:
 *       200:
 *         description: Route updated successfully
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
 *                   nullable: true
 *                 notes:
 *                   type: string
 *                   nullable: true
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Route not found
 *       500:
 *         description: Internal server error
 */
router.patch('/:id', requireAuth, validateBody(UpdateRouteSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const { data: route, error: fetchError } = await supabase
      .from('routes')
      .select('id, creator_id, is_active')
      .eq('id', id)
      .single();

    if (fetchError || !route || !route.is_active) {
      return res.status(404).json({
        error: 'Route not found',
        message: `No active route found with id ${id}`,
      });
    }

    if (route.creator_id !== userId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You can only update routes you created',
      });
    }

    const updates = {};

    if (Object.prototype.hasOwnProperty.call(req.body, 'title')) {
      updates.title = req.body.title;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'description')) {
      updates.description = normaliseOptionalText(req.body.description);
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'notes')) {
      updates.notes = normaliseOptionalText(req.body.notes);
    }

    const { data: updatedRoute, error: updateError } = await supabase
      .from('routes')
      .update(updates)
      .eq('id', id)
      .eq('is_active', true)
      .select('id, title, description, notes')
      .single();

    if (updateError || !updatedRoute) {
      console.error('Error updating route:', updateError);
      return res.status(500).json({
        error: 'Failed to update route',
        message: updateError?.message ?? 'Unknown database error',
      });
    }

    res.json(updatedRoute);
  } catch (error) {
    console.error('Error in PATCH /routes/:id:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
});

module.exports = router;
