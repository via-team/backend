const express = require("express");
const supabase = require("../config/supabase");

const router = express.Router();

/**
 * @swagger
 * /api/v1/routes:
 *   post:
 *     summary: Create a route
 *     description: Create a new route with title, desription, start/end labels, times, tags, and points
 *     tags: [Routes]
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
router.post("/", async (req, res) => {
  try {
    const {
      title,
      description,
      start_label,
      end_label,
      start_time,
      end_time,
      tags,
      points
    } = req.body;

    // Validate required fields
    if (!title || !start_label || !end_label || !start_time || !end_time || !points || points.length === 0) {
      return res.status(400).json({
        error: "Missing required fields",
        required: ["title", "start_label", "end_label", "start_time", "end_time", "points"]
      });
    }

    // Sort points by sequence to ensure correct order
    const sortedPoints = points.sort((a, b) => a.seq - b.seq);
    
    // Get first and last points for start/end locations
    const firstPoint = sortedPoints[0];
    const lastPoint = sortedPoints[sortedPoints.length - 1];

    // Calculate duration in seconds
    const startDate = new Date(start_time);
    const endDate = new Date(end_time);
    const durationSeconds = Math.floor((endDate - startDate) / 1000);

    // Calculate distance using Haversine formula
    const calculateDistance = (points) => {
      let totalDistance = 0;
      for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];
        
        const R = 6371000; // Earth's radius in meters
        const lat1 = p1.lat * Math.PI / 180;
        const lat2 = p2.lat * Math.PI / 180;
        const deltaLat = (p2.lat - p1.lat) * Math.PI / 180;
        const deltaLng = (p2.lng - p1.lng) * Math.PI / 180;

        const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
                  Math.cos(lat1) * Math.cos(lat2) *
                  Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        
        totalDistance += R * c;
      }
      return totalDistance;
    };

    const distanceMeters = calculateDistance(sortedPoints);

    // TODO: Get creator_id from authenticated user session
    // For now, this will be null - you'll need to implement authentication middleware
    const creator_id = null;

    // Insert route into database using RPC to handle PostGIS geography type
    const { data: routeData, error: routeError } = await supabase.rpc('create_route_with_geography', {
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
      p_distance_meters: distanceMeters
    });

    if (routeError) {
      console.error("Error creating route:", routeError);
      return res.status(500).json({ error: "Failed to create route", details: routeError.message });
    }

    const routeId = routeData;

    // Insert route points
    const routePointsToInsert = sortedPoints.map((point) => ({
      sequence: point.seq,
      lng: point.lng,
      lat: point.lat,
      recorded_at: point.time,
      accuracy_meters: point.acc || null
    }));

    // Insert route points using RPC to handle PostGIS geography type
    const { error: pointsError } = await supabase.rpc('insert_route_points', {
      p_route_id: routeId,
      p_points: routePointsToInsert
    });

    if (pointsError) {
      console.error("Error inserting route points:", pointsError);
      // Consider whether to rollback the route creation
      return res.status(500).json({ error: "Failed to insert route points", details: pointsError.message });
    }

    // Insert route tags if provided
    if (tags && tags.length > 0) {
      const routeTagsToInsert = tags.map(tagId => ({
        route_id: routeId,
        tag_id: tagId
      }));

      const { error: tagsError } = await supabase
        .from('route_tags')
        .insert(routeTagsToInsert);

      if (tagsError) {
        console.error("Error inserting route tags:", tagsError);
        // Don't fail the entire request for tags, just log the error
      }
    }

    res.status(201).json({ route_id: routeId });
  } catch (error) {
    console.error("Error creating route:", error);
    res.status(500).json({ error: "Internal server error", details: error.message });
  }
});

/**
 * @swagger
 * /api/v1/routes:
 *   get:
 *     summary: Search and feed routes
 *     description: Search for routes by location, radius, destination, tags, and sort order
 *     tags: [Routes]
 *     parameters:
 *       - in: query
 *         name: lat
 *         schema:
 *           type: number
 *           format: float
 *         description: User's current latitude
 *       - in: query
 *         name: lng
 *         schema:
 *           type: number
 *           format: float
 *         description: User's current longitude
 *       - in: query
 *         name: radius
 *         schema:
 *           type: integer
 *           default: 500
 *         description: Search radius in meters
 *       - in: query
 *         name: dest_lat
 *         schema:
 *           type: number
 *           format: float
 *         description: Destination latitude (optional)
 *       - in: query
 *         name: dest_lng
 *         schema:
 *           type: number
 *           format: float
 *         description: Destination longitude (optional)
 *       - in: query
 *         name: tags
 *         schema:
 *           type: string
 *         description: CSV string of tag IDs (e.g., "shade,quiet")
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
 */
router.get("/", (req, res) => {
  res.json({ data: [] });
});

/**
 * @swagger
 * /api/v1/routes/{id}:
 *   get:
 *     summary: Get specific route
 *     description: Get full route object including all route points
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
 *         description: Full route object with route_points
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
 *                 start_time:
 *                   type: string
 *                   format: date-time
 *                 end_time:
 *                   type: string
 *                   format: date-time
 *                 tags:
 *                   type: array
 *                   items:
 *                     type: string
 *                 route_points:
 *                   type: array
 *                   items:
 *                     type: object
 */
router.get("/:id", (req, res) => {
  res.json({});
});

/**
 * @swagger
 * /api/v1/routes/{id}/vote:
 *   post:
 *     summary: Upvote or downvote a route
 *     description: Vote on a route with a specific context (safety, efficiency, or scenery)
 *     tags: [Routes]
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
 *             required:
 *               - vote_type
 *               - context
 *             properties:
 *               vote_type:
 *                 type: string
 *                 enum: [up, down]
 *                 example: "up"
 *               context:
 *                 type: string
 *                 enum: [safety, efficiency, scenery]
 *                 example: "safety"
 *     responses:
 *       201:
 *         description: Vote recorded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 route_id:
 *                   type: string
 *                   format: uuid
 *                 vote_type:
 *                   type: string
 *                 context:
 *                   type: string
 */
router.post("/:id/vote", (req, res) => {
  res.status(201).json({});
});

/**
 * @swagger
 * /api/v1/routes/{id}/comments:
 *   post:
 *     summary: Add a comment to a route
 *     description: Post a comment on a specific route
 *     tags: [Routes]
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
 *             required:
 *               - content
 *             properties:
 *               content:
 *                 type: string
 *                 example: "Super cool route Nolan!"
 *     responses:
 *       201:
 *         description: Comment added successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 route_id:
 *                   type: string
 *                   format: uuid
 *                 content:
 *                   type: string
 */
router.post("/:id/comments", (req, res) => {
  res.status(201).json({});
});

module.exports = router;
