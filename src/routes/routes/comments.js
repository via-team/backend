const express = require('express');
const supabase = require('../../config/supabase');
const { requireAuth } = require('../../middleware/auth');
const { commentRateLimit } = require('../../middleware/rateLimit');
const { validateBody, validateQuery } = require('../../middleware/validate');
const { CommentSchema, ListCommentsQuerySchema } = require('../../schemas/routes');

const router = express.Router();
const COMMENT_SELECT = 'id, route_id, user_id, content, created_at';

function byCreatedAtThenId(a, b) {
  const createdAtCompare = new Date(a.created_at) - new Date(b.created_at);
  if (createdAtCompare !== 0) {
    return createdAtCompare;
  }

  return a.id.localeCompare(b.id);
}

/**
 * @swagger
 * /api/v1/routes/{id}/comments:
 *   get:
 *     summary: List comments for a route
 *     description: Returns route comments in chronological order with author display names and a cursor for forward pagination
 *     tags: [Routes]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Route ID
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *         description: Maximum comments to return
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID of the last comment from the previous page
 *     responses:
 *       200:
 *         description: Comment page returned successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 comments:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       route_id:
 *                         type: string
 *                         format: uuid
 *                       user_id:
 *                         type: string
 *                         format: uuid
 *                       content:
 *                         type: string
 *                       created_at:
 *                         type: string
 *                         format: date-time
 *                       author_display_name:
 *                         type: string
 *                         nullable: true
 *                 next_cursor:
 *                   type: string
 *                   format: uuid
 *                   nullable: true
 *       400:
 *         description: Invalid query parameters or cursor
 *       404:
 *         description: Route not found
 *       500:
 *         description: Internal server error
 */
router.get('/:id/comments', validateQuery(ListCommentsQuerySchema), async (req, res) => {
  try {
    const { id } = req.params;
    const { limit, cursor } = req.query;

    const { data: route, error: routeError } = await supabase
      .from('routes')
      .select('id')
      .eq('id', id)
      .eq('is_active', true)
      .single();

    if (routeError || !route) {
      return res.status(404).json({
        error: 'Route not found',
        message: `No active route found with id ${id}`,
      });
    }

    let commentRows = [];

    if (cursor) {
      const { data: cursorComment, error: cursorError } = await supabase
        .from('comments')
        .select('id, route_id, created_at')
        .eq('id', cursor)
        .eq('route_id', id)
        .single();

      if (cursorError || !cursorComment) {
        return res.status(400).json({
          error: 'Invalid cursor',
          message: 'cursor must reference an existing comment for this route',
        });
      }

      const [sameTimestampResult, laterResult] = await Promise.all([
        supabase
          .from('comments')
          .select(COMMENT_SELECT)
          .eq('route_id', id)
          .eq('created_at', cursorComment.created_at)
          .gt('id', cursorComment.id)
          .order('id', { ascending: true })
          .limit(limit + 1),
        supabase
          .from('comments')
          .select(COMMENT_SELECT)
          .eq('route_id', id)
          .gt('created_at', cursorComment.created_at)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .limit(limit + 1),
      ]);

      if (sameTimestampResult.error) {
        console.error('Error fetching same-timestamp comments:', sameTimestampResult.error);
        return res.status(500).json({
          error: 'Failed to fetch comments',
          message: sameTimestampResult.error.message,
        });
      }

      if (laterResult.error) {
        console.error('Error fetching later comments:', laterResult.error);
        return res.status(500).json({
          error: 'Failed to fetch comments',
          message: laterResult.error.message,
        });
      }

      commentRows = [...(sameTimestampResult.data || []), ...(laterResult.data || [])]
        .sort(byCreatedAtThenId)
        .slice(0, limit + 1);
    } else {
      const { data, error } = await supabase
        .from('comments')
        .select(COMMENT_SELECT)
        .eq('route_id', id)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(limit + 1);

      if (error) {
        console.error('Error fetching comments:', error);
        return res.status(500).json({
          error: 'Failed to fetch comments',
          message: error.message,
        });
      }

      commentRows = data || [];
    }

    const hasMore = commentRows.length > limit;
    const pageComments = hasMore ? commentRows.slice(0, limit) : commentRows;
    const userIds = [...new Set(pageComments.map((comment) => comment.user_id))];

    let profileMap = new Map();
    if (userIds.length > 0) {
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', userIds);

      if (profilesError) {
        console.error('Error fetching comment authors:', profilesError);
        return res.status(500).json({
          error: 'Failed to fetch comments',
          message: profilesError.message,
        });
      }

      profileMap = new Map((profiles || []).map((profile) => [profile.id, profile.full_name ?? null]));
    }

    return res.json({
      comments: pageComments.map((comment) => ({
        id: comment.id,
        route_id: comment.route_id,
        user_id: comment.user_id,
        content: comment.content,
        created_at: comment.created_at,
        author_display_name: profileMap.get(comment.user_id) ?? null,
      })),
      next_cursor: hasMore && pageComments.length > 0 ? pageComments[pageComments.length - 1].id : null,
    });
  } catch (error) {
    console.error('Error in GET /routes/:id/comments:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
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
 *                 comment_id:
 *                   type: string
 *                   format: uuid
 *                 route_id:
 *                   type: string
 *                   format: uuid
 *                 user_id:
 *                   type: string
 *                   format: uuid
 *                 content:
 *                   type: string
 *                 created_at:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Missing or empty content
 *       404:
 *         description: Route not found
 *       500:
 *         description: Internal server error
 */
router.post('/:id/comments', commentRateLimit, requireAuth, validateBody(CommentSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;
    const user_id = req.user.id;

    const { data: route, error: routeError } = await supabase
      .from('routes')
      .select('id')
      .eq('id', id)
      .eq('is_active', true)
      .single();

    if (routeError || !route) {
      return res.status(404).json({
        error: 'Route not found',
        message: `No active route found with id ${id}`,
      });
    }

    const { data: comment, error: commentError } = await supabase
      .from('comments')
      .insert({ route_id: id, user_id, content })
      .select()
      .single();

    if (commentError) {
      console.error('Error inserting comment:', commentError);
      return res.status(500).json({
        error: 'Failed to add comment',
        message: commentError.message,
      });
    }

    res.status(201).json({
      message: 'Comment added successfully',
      comment_id: comment.id,
      route_id: comment.route_id,
      user_id: comment.user_id,
      content: comment.content,
      created_at: comment.created_at,
    });
  } catch (error) {
    console.error('Error in POST /routes/:id/comments:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
});

module.exports = router;
