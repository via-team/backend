const express = require('express');
const supabase = require('../../config/supabase');
const { requireAuth } = require('../../middleware/auth');
const { validateBody } = require('../../middleware/validate');
const { calculateDistance } = require('../../utils/geo');
const { CreateRouteSchema } = require('../../schemas/routes');

const router = express.Router();

/**
 * @swagger
 * /api/v1/routes:
 *   post:
 *     summary: Create a route
 *     description: Create a new route with title, desription, start/end labels, times, tags, and points
 *     tags: [Routes]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - start_label
 *               - end_label
 *               - start_time
 *               - end_time
 *               - points
 *             properties:
 *               title:
 *                 type: string
 *                 example: "Quickest way to GDC from Jester"
 *               description:
 *                 type: string
 *                 example: "Avoids the Speedway crowd."
 *               start_label:
 *                 type: string
 *                 example: "Jester West"
 *               end_label:
 *                 type: string
 *                 example: "GDC 2.216"
 *               start_time:
 *                 type: string
 *                 format: date-time
 *                 example: "2023-10-27T10:00:00Z"
 *               end_time:
 *                 type: string
 *                 format: date-time
 *                 example: "2023-10-27T10:15:00Z"
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *                 example: ["uuid-short-cut", "uuid-shade"]
 *               points:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     seq:
 *                       type: integer
 *                     lat:
 *                       type: number
 *                       format: float
 *                     lng:
 *                       type: number
 *                       format: float
 *                     acc:
 *                       type: number
 *                       format: float
 *                     time:
 *                       type: string
 *                       format: date-time
 *     responses:
 *       201:
 *         description: Route created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 route_id:
 *                   type: string
 *                   format: uuid
 */
router.post('/', requireAuth, validateBody(CreateRouteSchema), async (req, res) => {
  try {
    const {
      title,
      description,
      start_label,
      end_label,
      start_time,
      end_time,
      tags,
      points,
    } = req.body;

    const sortedPoints = points.sort((a, b) => a.seq - b.seq);
    const firstPoint = sortedPoints[0];
    const lastPoint = sortedPoints[sortedPoints.length - 1];

    const startDate = new Date(start_time);
    const endDate = new Date(end_time);
    const durationSeconds = Math.floor((endDate - startDate) / 1000);
    const distanceMeters = calculateDistance(sortedPoints);
    const creator_id = req.user.id;

    const { data: routeData, error: routeError } = await supabase.rpc(
      'create_route_with_geography',
      {
        p_creator_id: creator_id,
        p_title: title,
        p_description: description || null,
        p_start_label: start_label,
        p_end_label: end_label,
        p_start_lng: firstPoint.lng,
        p_start_lat: firstPoint.lat,
        p_end_lng: lastPoint.lng,
        p_end_lat: lastPoint.lat,
        p_start_time: start_time,
        p_end_time: end_time,
        p_duration_seconds: durationSeconds,
        p_distance_meters: distanceMeters,
      },
    );

    if (routeError) {
      console.error('Error creating route:', routeError);
      return res.status(500).json({
        error: 'Failed to create route',
        message: routeError.message,
      });
    }

    const routeId = routeData;

    const routePointsToInsert = sortedPoints.map((point) => ({
      sequence: point.seq,
      lng: point.lng,
      lat: point.lat,
      recorded_at: point.time,
      accuracy_meters: point.acc || null,
    }));

    const { error: pointsError } = await supabase.rpc('insert_route_points', {
      p_route_id: routeId,
      p_points: routePointsToInsert,
    });

    if (pointsError) {
      console.error('Error inserting route points:', pointsError);
      return res.status(500).json({
        error: 'Failed to insert route points',
        message: pointsError.message,
      });
    }

    if (tags && tags.length > 0) {
      const routeTagsToInsert = tags.map((tagId) => ({
        route_id: routeId,
        tag_id: tagId,
      }));

      const { error: tagsError } = await supabase
        .from('route_tags')
        .insert(routeTagsToInsert);

      if (tagsError) {
        console.error('Error inserting route tags:', tagsError);
      }
    }

    res.status(201).json({ route_id: routeId });
  } catch (error) {
    console.error('Error creating route:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
});

module.exports = router;
