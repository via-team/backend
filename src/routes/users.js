const express = require('express');
const supabase = require('../config/supabase');
const { validateBody, validateParams } = require('../middleware/validate');
const { FriendRequestSchema, FriendParamSchema } = require('../schemas/users');
const { friendIdsForUser, getFriendshipRows, outboundRow, inboundRow } = require('../services/friends');
const { ROUTE_LIST_SELECT, enrichRoutesForList } = require('../services/routeList');

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
 * /api/v1/users/me/friends:
 *   get:
 *     summary: List accepted mutual friends
 *     description: Returns all accepted mutual friends for the authenticated user, with basic profile info for each.
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of accepted friends
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
 *                       display_name:
 *                         type: string
 *                         nullable: true
 *                       email:
 *                         type: string
 *                         format: email
 *                       friends_since:
 *                         type: string
 *                         format: date-time
 *                 count:
 *                   type: integer
 *       401:
 *         description: Missing or invalid JWT
 *       500:
 *         description: Internal server error
 */
router.get('/me/friends', async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: friendsData, error: friendsError } = await supabase
      .from('friends')
      .select('requester_id, addressee_id, created_at')
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
      .eq('status', 'accepted');

    if (friendsError) {
      console.error('Error fetching friends:', friendsError);
      return res.status(500).json({ error: 'Internal server error', message: friendsError.message });
    }

    const friendIds = friendIdsForUser(userId, friendsData || []);

    if (friendIds.length === 0) {
      return res.json({ data: [], count: 0 });
    }

    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', friendIds);

    if (profilesError) {
      console.error('Error fetching friend profiles:', profilesError);
      return res.status(500).json({ error: 'Internal server error', message: profilesError.message });
    }

    // Index friendship created_at by the other user's id
    const friendsSince = {};
    for (const row of friendsData || []) {
      const otherId = row.requester_id === userId ? row.addressee_id : row.requester_id;
      friendsSince[otherId] = row.created_at;
    }

    const friends = (profiles || []).map((p) => ({
      id: p.id,
      display_name: p.full_name,
      email: p.email,
      friends_since: friendsSince[p.id] || null,
    }));

    return res.json({ data: friends, count: friends.length });
  } catch (error) {
    console.error('Error in GET /users/me/friends:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * @swagger
 * /api/v1/users/friends/request:
 *   post:
 *     summary: Send or reciprocally accept a friend request
 *     description: |
 *       Starts the mutual-friendship flow.
 *
 *       - If no relationship exists, creates a pending request and returns `201`.
 *       - If the target user has already sent you a pending request, it is automatically
 *         accepted and a mutual friendship is formed (`200`).
 *       - Self-requests return `400`.
 *       - A duplicate pending request or an already-accepted friendship returns `409`.
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
 *         description: Friend request sent (pending)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 status:
 *                   type: string
 *                   example: pending
 *                 friend_id:
 *                   type: string
 *                   format: uuid
 *       200:
 *         description: Reciprocal request auto-accepted — now mutual friends
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 status:
 *                   type: string
 *                   example: accepted
 *                 friend_id:
 *                   type: string
 *                   format: uuid
 *       400:
 *         description: Self-request or validation error
 *       401:
 *         description: Missing or invalid JWT
 *       404:
 *         description: Target user not found
 *       409:
 *         description: Duplicate pending request or already friends
 *       500:
 *         description: Internal server error
 */
router.post('/friends/request', validateBody(FriendRequestSchema), async (req, res) => {
  try {
    const userId = req.user.id;
    const { friend_id: targetId } = req.body;

    if (userId === targetId) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'You cannot send a friend request to yourself',
      });
    }

    // Verify the target user exists
    const { data: targetProfile, error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', targetId)
      .single();

    if (profileError || !targetProfile) {
      return res.status(404).json({
        error: 'User not found',
        message: 'The specified user does not exist',
      });
    }

    const { rows, error: fetchError } = await getFriendshipRows(supabase, userId, targetId);
    if (fetchError) {
      console.error('Error fetching friendship rows:', fetchError);
      return res.status(500).json({ error: 'Internal server error', message: fetchError.message });
    }

    const ob = outboundRow(rows, userId);
    const ib = inboundRow(rows, userId);

    if ((ob && ob.status === 'accepted') || (ib && ib.status === 'accepted')) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'You are already friends with this user',
      });
    }

    if (ob && ob.status === 'pending') {
      return res.status(409).json({
        error: 'Conflict',
        message: 'A friend request to this user is already pending',
      });
    }

    // Inbound pending exists — reciprocal auto-accept
    if (ib && ib.status === 'pending') {
      const { error: updateError } = await supabase
        .from('friends')
        .update({ status: 'accepted' })
        .eq('requester_id', targetId)
        .eq('addressee_id', userId);

      if (updateError) {
        console.error('Error auto-accepting friend request:', updateError);
        return res.status(500).json({ error: 'Internal server error', message: updateError.message });
      }

      return res.status(200).json({
        message: 'Friend request accepted — you are now mutual friends',
        status: 'accepted',
        friend_id: targetId,
      });
    }

    // No relationship — create pending request
    const { error: insertError } = await supabase
      .from('friends')
      .insert({ requester_id: userId, addressee_id: targetId, status: 'pending' });

    if (insertError) {
      console.error('Error creating friend request:', insertError);
      return res.status(500).json({ error: 'Internal server error', message: insertError.message });
    }

    return res.status(201).json({
      message: 'Friend request sent',
      status: 'pending',
      friend_id: targetId,
    });
  } catch (error) {
    console.error('Error in POST /users/friends/request:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * @swagger
 * /api/v1/users/friends/{id}/accept:
 *   post:
 *     summary: Explicitly accept an inbound friend request
 *     description: |
 *       Accepts a pending friend request sent by the user identified by `{id}`.
 *       Use this endpoint when the request was not automatically accepted via the
 *       reciprocal-request path in `POST /friends/request`.
 *
 *       Returns `404` if no inbound pending request from that user exists,
 *       and `409` if the friendship is already accepted.
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID of the user whose friend request you are accepting
 *     responses:
 *       200:
 *         description: Friend request accepted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 status:
 *                   type: string
 *                   example: accepted
 *                 friend_id:
 *                   type: string
 *                   format: uuid
 *       400:
 *         description: Invalid UUID or self-accept attempt
 *       401:
 *         description: Missing or invalid JWT
 *       404:
 *         description: No inbound pending request from this user
 *       409:
 *         description: Already friends with this user
 *       500:
 *         description: Internal server error
 */
router.post('/friends/:id/accept', validateParams(FriendParamSchema), async (req, res) => {
  try {
    const userId = req.user.id;
    const targetId = req.params.id;

    if (userId === targetId) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'You cannot accept a friend request from yourself',
      });
    }

    // Look for an inbound pending row: (targetId → userId)
    const { data: row, error: fetchError } = await supabase
      .from('friends')
      .select('status')
      .eq('requester_id', targetId)
      .eq('addressee_id', userId)
      .single();

    if (fetchError || !row) {
      return res.status(404).json({
        error: 'Not found',
        message: 'No pending friend request from this user',
      });
    }

    if (row.status === 'accepted') {
      return res.status(409).json({
        error: 'Conflict',
        message: 'You are already friends with this user',
      });
    }

    const { error: updateError } = await supabase
      .from('friends')
      .update({ status: 'accepted' })
      .eq('requester_id', targetId)
      .eq('addressee_id', userId);

    if (updateError) {
      console.error('Error accepting friend request:', updateError);
      return res.status(500).json({ error: 'Internal server error', message: updateError.message });
    }

    return res.status(200).json({
      message: 'Friend request accepted',
      status: 'accepted',
      friend_id: targetId,
    });
  } catch (error) {
    console.error('Error in POST /users/friends/:id/accept:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * @swagger
 * /api/v1/users/friends/{id}:
 *   delete:
 *     summary: Remove a friendship or cancel/decline a friend request
 *     description: |
 *       Removes the friendship row for the unordered pair (current user, `{id}`)
 *       regardless of which user originally sent the request or what direction the row
 *       is stored in.
 *
 *       Works for accepted friendships (unfriend), outbound pending requests (cancel),
 *       and inbound pending requests (decline) with a single endpoint.
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID of the other user in the relationship
 *     responses:
 *       204:
 *         description: Relationship removed
 *       400:
 *         description: Invalid UUID
 *       401:
 *         description: Missing or invalid JWT
 *       404:
 *         description: No friendship or pending request exists with this user
 *       500:
 *         description: Internal server error
 */
router.delete('/friends/:id', validateParams(FriendParamSchema), async (req, res) => {
  try {
    const userId = req.user.id;
    const targetId = req.params.id;

    const { rows, error: fetchError } = await getFriendshipRows(supabase, userId, targetId);
    if (fetchError) {
      console.error('Error checking friendship:', fetchError);
      return res.status(500).json({ error: 'Internal server error', message: fetchError.message });
    }

    if (rows.length === 0) {
      return res.status(404).json({
        error: 'Not found',
        message: 'No friendship or pending request exists with this user',
      });
    }

    const row = rows[0];
    const { error: deleteError } = await supabase
      .from('friends')
      .delete()
      .eq('requester_id', row.requester_id)
      .eq('addressee_id', row.addressee_id);

    if (deleteError) {
      console.error('Error deleting friendship:', deleteError);
      return res.status(500).json({ error: 'Internal server error', message: deleteError.message });
    }

    return res.status(204).send();
  } catch (error) {
    console.error('Error in DELETE /users/friends/:id:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * @swagger
 * /api/v1/users/me/saved:
 *   get:
 *     summary: Get routes saved by the current user
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of saved routes
 *       401:
 *         description: Unauthorized
 */
router.get('/me/saved', async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: savedRows, error: savedError } = await supabase
      .from('saved_routes')
      .select('route_id')
      .eq('user_id', userId)
      .order('saved_at', { ascending: false });

    if (savedError) {
      console.error('Error fetching saved routes:', savedError);
      return res.status(500).json({ error: 'Failed to fetch saved routes', message: savedError.message });
    }

    if (!savedRows || savedRows.length === 0) {
      return res.json({ data: [], count: 0 });
    }

    const routeIds = savedRows.map((r) => r.route_id);

    const { data: routes, error: routesError } = await supabase
      .from('routes')
      .select(ROUTE_LIST_SELECT)
      .eq('is_active', true)
      .in('id', routeIds);

    if (routesError) {
      console.error('Error fetching saved route details:', routesError);
      return res.status(500).json({ error: 'Failed to fetch routes', message: routesError.message });
    }

    const userSupabase = supabase.createUserClient(req.token);
    const { items } = await enrichRoutesForList(supabase, routes || [], userId, {
      savedRoutesSupabase: userSupabase,
    });
    const finalRoutes = items.map((r) => ({ ...r, is_saved: true }));

    // Preserve saved_at order
    const savedAtByRoute = Object.fromEntries(savedRows.map((r, i) => [r.route_id, i]));
    finalRoutes.sort((a, b) => (savedAtByRoute[a.id] ?? 999) - (savedAtByRoute[b.id] ?? 999));

    res.json({ data: finalRoutes, count: finalRoutes.length });
  } catch (error) {
    console.error('Error in GET /users/me/saved:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

module.exports = router;
