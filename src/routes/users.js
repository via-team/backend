const express = require('express');

const router = express.Router();

/**
 * @swagger
 * /api/v1/users/me:
 *   get:
 *     summary: Get current user profile and stats
 *     description: Returns the authenticated user's profile information and statistics
 *     tags: [Users]
 *     responses:
 *       200:
 *         description: User profile and stats
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   format: uuid
 *                 email:
 *                   type: string
 *                   format: email
 *                 display_name:
 *                   type: string
 *                   nullable: true
 *                 stats:
 *                   type: object
 *                   properties:
 *                     routes_created:
 *                       type: integer
 *                     routes_saved:
 *                       type: integer
 *                     friends_count:
 *                       type: integer
 */
router.get('/me', (req, res) => {
  res.json({});
});

/**
 * @swagger
 * /api/v1/users/friends/request:
 *   post:
 *     summary: Send friend request
 *     description: Send a friend request to another user
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - friend_id
 *             properties:
 *               friend_id:
 *                 type: string
 *                 format: uuid
 *                 example: "123e4567-e89b-12d3-a456-426614174000"
 *     responses:
 *       201:
 *         description: Friend request sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 friend_id:
 *                   type: string
 *                   format: uuid
 */
router.post('/friends/request', (req, res) => {
  res.status(201).json({});
});

module.exports = router;
