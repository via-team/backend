const express = require('express');
const supabase = require('../../config/supabase');
const { requireAuth } = require('../../middleware/auth');
const { validateBody } = require('../../middleware/validate');
const { CommentSchema } = require('../../schemas/routes');

const router = express.Router();

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
router.post('/:id/comments', requireAuth, validateBody(CommentSchema), async (req, res) => {
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
