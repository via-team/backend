const express = require('express');

const router = express.Router();

/**
 * @swagger
 * /api/v1/routes:
 *   post:
 *     summary: Create a route
 *     description: Create a new route with title, description, start/end labels, times, tags, and points
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
router.post('/', (req, res) => {
  res.status(201).json({ route_id: '' });
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
router.get('/', (req, res) => {
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
router.get('/:id', (req, res) => {
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
router.post('/:id/vote', (req, res) => {
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
router.post('/:id/comments', (req, res) => {
  res.status(201).json({});
});

module.exports = router;
