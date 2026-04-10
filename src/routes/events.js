const express = require('express');
const supabase = require('../config/supabase');
const { createUserClient } = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const { createEventRateLimit } = require('../middleware/rateLimit');
const { validateBody, validateQuery } = require('../middleware/validate');
const { CreateEventSchema, ListEventsQuerySchema } = require('../schemas/events');

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Events
 *   description: Live campus events (crime, crowds, construction, etc.)
 */

/**
 * @swagger
 * /api/v1/events:
 *   post:
 *     summary: File a new campus event
 *     description: >
 *       Reports a time-bounded campus event at a given location. The server computes `expires_at`
 *       from `duration_minutes`. Requires authentication; the authenticated user becomes the reporter.
 *     tags: [Events]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type
 *               - lat
 *               - lng
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [construction, muddy_path, crash, weapon, unsafe, blocked_road, police, crowd_protest]
 *                 example: crowd_protest
 *               duration_minutes:
 *                 type: integer
 *                 minimum: 1
 *                 description: Optional — defaults to 120 minutes server-side when omitted
 *                 example: 30
 *               lat:
 *                 type: number
 *                 format: float
 *                 example: 30.2849
 *               lng:
 *                 type: number
 *                 format: float
 *                 example: -97.7341
 *               description:
 *                 type: string
 *                 example: "Big crowd near the union"
 *               location_label:
 *                 type: string
 *                 example: "West Mall"
 *               route_id:
 *                 type: string
 *                 format: uuid
 *                 description: Optional — route the user was navigating when they filed the event
 *     responses:
 *       201:
 *         description: Event created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 event_id:
 *                   type: string
 *                   format: uuid
 *                 message:
 *                   type: string
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.post('/', createEventRateLimit, requireAuth, validateBody(CreateEventSchema), async (req, res) => {
  try {
    const { type, lat, lng, description, duration_minutes, location_label, route_id } = req.body;
    const reporter_id = req.user.id;

    // Use the user's JWT so RLS auth.uid() resolves correctly
    const userSupabase = createUserClient(req.token);
    const { data: eventId, error } = await userSupabase.rpc('create_event_with_geography', {
      p_reporter_id: reporter_id,
      p_type: type,
      p_description: description ?? null,
      p_lng: lng,
      p_lat: lat,
      p_location_label: location_label ?? null,
      p_route_id: route_id ?? null,
      p_duration_minutes: duration_minutes ?? null,
    });

    if (error) {
      console.error('Error calling create_event_with_geography:', error);
      return res.status(500).json({
        error: 'Failed to create event',
        message: error.message,
      });
    }

    res.status(201).json({
      event_id: eventId,
      message: 'Event created successfully',
    });
  } catch (error) {
    console.error('Error in POST /events:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * @swagger
 * /api/v1/events:
 *   get:
 *     summary: List active campus events
 *     description: >
 *       Returns all active, non-expired campus events. When `lat` and `lng` are supplied, results
 *       are filtered to within `radius` metres of that point using PostGIS `ST_DWithin`.
 *     tags: [Events]
 *     parameters:
 *       - in: query
 *         name: lat
 *         schema:
 *           type: number
 *           format: float
 *         description: Latitude of the centre point for spatial filtering
 *       - in: query
 *         name: lng
 *         schema:
 *           type: number
 *           format: float
 *         description: Longitude of the centre point for spatial filtering
 *       - in: query
 *         name: radius
 *         schema:
 *           type: integer
 *           default: 500
 *         description: Radius in metres (only used when lat/lng are provided)
 *     responses:
 *       200:
 *         description: List of active events
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
 *                       reporter_id:
 *                         type: string
 *                         format: uuid
 *                       type:
 *                         type: string
 *                       description:
 *                         type: string
 *                       lat:
 *                         type: number
 *                         format: float
 *                       lng:
 *                         type: number
 *                         format: float
 *                       location_label:
 *                         type: string
 *                       route_id:
 *                         type: string
 *                         format: uuid
 *                       duration_minutes:
 *                         type: integer
 *                       expires_at:
 *                         type: string
 *                         format: date-time
 *                       created_at:
 *                         type: string
 *                         format: date-time
 *                 count:
 *                   type: integer
 *       400:
 *         description: Validation error (e.g. lat provided without lng)
 *       500:
 *         description: Internal server error
 */
router.get('/', validateQuery(ListEventsQuerySchema), async (req, res) => {
  try {
    const { lat, lng, radius } = req.query;

    let data, error;

    if (lat !== undefined && lng !== undefined) {
      ({ data, error } = await supabase.rpc('get_events_near', {
        p_lat: lat,
        p_lng: lng,
        p_radius_meters: radius,
      }));
    } else {
      ({ data, error } = await supabase.rpc('list_active_events'));
    }

    if (error) {
      console.error('Error fetching events:', error);
      return res.status(500).json({ error: 'Failed to fetch events', message: error.message });
    }

    res.json({ data: data ?? [], count: (data ?? []).length });
  } catch (error) {
    console.error('Error in GET /events:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * @swagger
 * /api/v1/events/{id}:
 *   delete:
 *     summary: Deactivate a campus event
 *     description: >
 *       Soft-deletes a campus event by setting `is_active = false`. Only the original reporter
 *       can deactivate their own event.
 *     tags: [Events]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Event ID
 *     responses:
 *       200:
 *         description: Event deactivated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — not the reporter
 *       404:
 *         description: Event not found or already inactive
 *       500:
 *         description: Internal server error
 */
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const user_id = req.user.id;

    const { data: event, error: fetchError } = await supabase
      .from('campus_events')
      .select('id, reporter_id, is_active')
      .eq('id', id)
      .single();

    if (fetchError || !event) {
      return res.status(404).json({
        error: 'Event not found',
        message: `No event found with id ${id}`,
      });
    }

    if (!event.is_active) {
      return res.status(404).json({
        error: 'Event not found',
        message: `Event ${id} is already inactive`,
      });
    }

    if (event.reporter_id !== user_id) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You can only deactivate events you reported',
      });
    }

    const { error: updateError } = await supabase
      .from('campus_events')
      .update({ is_active: false })
      .eq('id', id);

    if (updateError) {
      console.error('Error deactivating event:', updateError);
      return res.status(500).json({
        error: 'Failed to deactivate event',
        message: updateError.message,
      });
    }

    res.json({ message: 'Event deactivated successfully' });
  } catch (error) {
    console.error('Error in DELETE /events/:id:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

module.exports = router;
