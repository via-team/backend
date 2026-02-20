const express = require("express");
const supabase = require("../config/supabase");
const { requireAuth } = require("../middleware/auth");

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
router.post("/", requireAuth, async (req, res) => {
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

    const creator_id = req.user.id;

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
router.get("/", async (req, res) => {
  try {
    const {
      lat,
      lng,
      radius = 500,
      dest_lat,
      dest_lng,
      tags,
      sort = 'recent'
    } = req.query;

    // Build the query
    let query = supabase
      .from('routes')
      .select(`
        id,
        title,
        start_label,
        end_label,
        distance_meters,
        created_at,
        route_tags (
          tags (
            name
          )
        )
      `)
      .eq('is_active', true);

    // Fetch all routes (will filter by location in application code if needed)
    const { data: routes, error: routesError } = await query.limit(100);

    if (routesError) {
      console.error("Error fetching routes:", routesError);
      return res.status(500).json({ 
        error: "Failed to fetch routes", 
        details: routesError.message 
      });
    }

    // Get vote statistics for all routes
    const routeIds = routes.map(r => r.id);
    let votesData = [];
    
    if (routeIds.length > 0) {
      const { data: votes, error: votesError } = await supabase
        .from('votes')
        .select('route_id, vote_type')
        .in('route_id', routeIds);

      if (!votesError && votes) {
        votesData = votes;
      }
    }

    // Calculate average ratings
    const votesByRoute = {};
    votesData.forEach(vote => {
      if (!votesByRoute[vote.route_id]) {
        votesByRoute[vote.route_id] = { up: 0, down: 0, total: 0 };
      }
      if (vote.vote_type === 'up') {
        votesByRoute[vote.route_id].up++;
      } else if (vote.vote_type === 'down') {
        votesByRoute[vote.route_id].down++;
      }
      votesByRoute[vote.route_id].total++;
    });

    // Transform routes data
    let transformedRoutes = routes.map(route => {
      const votes = votesByRoute[route.id] || { up: 0, down: 0, total: 0 };
      const avgRating = votes.total > 0 
        ? (votes.up - votes.down) / votes.total 
        : 0;

      const routeTags = route.route_tags 
        ? route.route_tags.map(rt => rt.tags?.name).filter(Boolean)
        : [];

      return {
        id: route.id,
        title: route.title,
        start_label: route.start_label,
        end_label: route.end_label,
        distance_meters: route.distance_meters,
        avg_rating: parseFloat(avgRating.toFixed(2)),
        tags: routeTags,
        preview_polyline: null,
        created_at: route.created_at,
        vote_count: votes.total
      };
    });

    // Filter by tags if provided
    if (tags) {
      const tagArray = tags.split(',').map(t => t.trim().toLowerCase());
      transformedRoutes = transformedRoutes.filter(route => 
        route.tags.some(tag => tagArray.includes(tag.toLowerCase()))
      );
    }

    // Sort routes based on sort parameter
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

    // Remove temporary fields and prepare final response
    const finalRoutes = transformedRoutes.map(({ vote_count, ...route }) => route);

    res.json({ 
      data: finalRoutes,
      count: finalRoutes.length,
      filters: {
        lat: lat ? parseFloat(lat) : null,
        lng: lng ? parseFloat(lng) : null,
        radius: parseInt(radius),
        tags: tags || null,
        sort: sort
      }
    });

  } catch (error) {
    console.error("Error in GET /routes:", error);
    res.status(500).json({ 
      error: "Internal server error", 
      message: error.message 
    });
  }
});

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
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { data: route, error } = await supabase
      .from('routes')
      .select(`*, route_points(*), route_tags(tags(name))`)
      .eq('id', id)
      .eq('is_active', true)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({
          error: 'Route not found',
          message: `No active route found with id ${id}`
        });
      }
      console.error('Error fetching route:', error);
      return res.status(500).json({ error: 'Failed to fetch route', message: error.message });
    }

    const { data: votes, error: votesError } = await supabase
      .from('votes')
      .select('vote_type')
      .eq('route_id', id);

    let avgRating = 0;
    let voteCount = 0;

    if (!votesError && votes) {
      voteCount = votes.length;
      if (voteCount > 0) {
        const upvotes = votes.filter(v => v.vote_type === 'up').length;
        const downvotes = votes.filter(v => v.vote_type === 'down').length;
        avgRating = parseFloat(((upvotes - downvotes) / voteCount).toFixed(2));
      }
    }

    const tags = route.route_tags
      ? route.route_tags.map(rt => rt.tags?.name).filter(Boolean)
      : [];

    const routePoints = route.route_points
      ? route.route_points
          .sort((a, b) => a.sequence - b.sequence)
          .map(p => ({
            seq: p.sequence,
            lat: p.lat,
            lng: p.lng,
            accuracy_meters: p.accuracy_meters,
            recorded_at: p.recorded_at
          }))
      : [];

    const { route_tags, route_points, ...routeFields } = route;

    res.json({
      ...routeFields,
      avg_rating: avgRating,
      vote_count: voteCount,
      tags,
      route_points: routePoints
    });
  } catch (error) {
    console.error('Error in GET /routes/:id:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * @swagger
 * /api/v1/routes/{id}/vote:
 *   post:
 *     summary: Upvote or downvote a route
 *     description: Cast an up or down vote on a route with a context category. One vote per user per route — re-voting replaces the previous vote.
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
 *                 vote_count:
 *                   type: integer
 *                 upvotes:
 *                   type: integer
 *                 downvotes:
 *                   type: integer
 *                 avg_rating:
 *                   type: number
 *                   format: float
 *       400:
 *         description: Missing or invalid fields
 *       404:
 *         description: Route not found
 *       500:
 *         description: Internal server error
 */
router.post("/:id/vote", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { vote_type, context } = req.body;
    const user_id = req.user.id;

    if (!vote_type || !context) {
      return res.status(400).json({
        error: "Missing required fields",
        required: ["vote_type", "context"]
      });
    }

    if (!["up", "down"].includes(vote_type)) {
      return res.status(400).json({
        error: "Invalid vote_type",
        message: "vote_type must be 'up' or 'down'"
      });
    }

    if (!["safety", "efficiency", "scenery"].includes(context)) {
      return res.status(400).json({
        error: "Invalid context",
        message: "context must be 'safety', 'efficiency', or 'scenery'"
      });
    }

    // Verify the route exists and is active
    const { data: route, error: routeError } = await supabase
      .from('routes')
      .select('id')
      .eq('id', id)
      .eq('is_active', true)
      .single();

    if (routeError || !route) {
      return res.status(404).json({
        error: "Route not found",
        message: `No active route found with id ${id}`
      });
    }

    // Upsert vote — one vote per user per route, re-voting replaces the previous vote
    const { error: voteError } = await supabase
      .from('votes')
      .upsert(
        { route_id: id, user_id, vote_type, context },
        { onConflict: 'route_id,user_id' }
      );

    if (voteError) {
      console.error("Error upserting vote:", voteError);
      return res.status(500).json({ error: "Failed to record vote", message: voteError.message });
    }

    // Fetch updated vote totals for the route
    const { data: votes, error: totalsError } = await supabase
      .from('votes')
      .select('vote_type')
      .eq('route_id', id);

    let vote_count = 0;
    let upvotes = 0;
    let downvotes = 0;
    let avg_rating = 0;

    if (!totalsError && votes) {
      vote_count = votes.length;
      upvotes = votes.filter(v => v.vote_type === 'up').length;
      downvotes = votes.filter(v => v.vote_type === 'down').length;
      avg_rating = vote_count > 0
        ? parseFloat(((upvotes - downvotes) / vote_count).toFixed(2))
        : 0;
    }

    res.status(201).json({
      message: "Vote recorded successfully",
      route_id: id,
      vote_type,
      context,
      vote_count,
      upvotes,
      downvotes,
      avg_rating
    });
  } catch (error) {
    console.error("Error in POST /routes/:id/vote:", error);
    res.status(500).json({ error: "Internal server error", message: error.message });
  }
});

/**
 * @swagger
 * /api/v1/routes/{id}/comments:
 *   post:
 *     summary: Add a comment to a route
 *     description: Post a comment on a specific route
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
router.post("/:id/comments", requireAuth, (req, res) => {
  res.status(201).json({});
});

module.exports = router;
