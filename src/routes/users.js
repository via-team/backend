const express = require('express');
const supabase = require('../config/supabase');

const router = express.Router();

/**
 * @swagger
 * /api/v1/users/me:
 *   get:
 *     summary: Get current user profile and stats
 *     description: Returns the authenticated user's profile information and statistics
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
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
 *       401:
 *         description: Missing or invalid JWT
 */
router.get('/me', async (req, res) => {
  try {
    const userId = req.user.id;

    // Fetch user profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, email, full_name, created_at')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      console.error("Error fetching profile:", profileError);
      return res.status(404).json({
        error: "User not found",
        message: "Could not find user profile"
      });
    }

    // Count routes created by the user
    const { count: routesCreated, error: routesError } = await supabase
      .from('routes')
      .select('*', { count: 'exact', head: true })
      .eq('creator_id', userId)
      .eq('is_active', true);

    if (routesError) {
      console.error("Error counting routes:", routesError);
    }

    // Count routes the user has used/saved (from route_usage table)
    const { count: routesSaved, error: usageError } = await supabase
      .from('route_usage')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (usageError) {
      console.error("Error counting route usage:", usageError);
    }

    // Count friends (both as requester and addressee with accepted status)
    const { data: friendsData, error: friendsError } = await supabase
      .from('friends')
      .select('*')
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
      .eq('status', 'accepted');

    if (friendsError) {
      console.error("Error counting friends:", friendsError);
    }

    const friendsCount = friendsData ? friendsData.length : 0;

    // Construct response
    const response = {
      id: profile.id,
      email: profile.email,
      display_name: profile.full_name,
      created_at: profile.created_at,
      stats: {
        routes_created: routesCreated || 0,
        routes_saved: routesSaved || 0,
        friends_count: friendsCount
      }
    };

    res.json(response);
  } catch (error) {
    console.error("Error in /users/me:", error);
    res.status(500).json({
      error: "Internal server error",
      message: error.message
    });
  }
});

/**
 * @swagger
 * /api/v1/users/friends/request:
 *   post:
 *     summary: Send friend request
 *     description: Send a friend request to another user
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
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
