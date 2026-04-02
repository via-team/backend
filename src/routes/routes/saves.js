const express = require('express');
const supabase = require('../../config/supabase');
const { requireAuth } = require('../../middleware/auth');

const router = express.Router();

/**
 * @swagger
 * /api/v1/routes/{id}/save:
 *   post:
 *     summary: Save (bookmark) a route
 *     description: Saves a route to the authenticated user's saved list. Idempotent — saving an already-saved route is a no-op.
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
 *     responses:
 *       201:
 *         description: Route saved
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Route not found
 *       500:
 *         description: Internal server error
 */
router.post('/:id/save', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const user_id = req.user.id;
    const userSupabase = supabase.createUserClient(req.token);

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

    const { error } = await userSupabase
      .from('saved_routes')
      .upsert({ user_id, route_id: id }, { onConflict: 'user_id,route_id' });

    if (error) {
      console.error('Error saving route:', error);
      return res.status(500).json({ error: 'Failed to save route', message: error.message });
    }

    res.status(201).json({ message: 'Route saved successfully' });
  } catch (error) {
    console.error('Error in POST /routes/:id/save:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * @swagger
 * /api/v1/routes/{id}/save:
 *   delete:
 *     summary: Unsave (remove bookmark) a route
 *     description: Removes a route from the authenticated user's saved list. Idempotent.
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
 *     responses:
 *       204:
 *         description: Route unsaved
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.delete('/:id/save', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const user_id = req.user.id;
    const userSupabase = supabase.createUserClient(req.token);

    const { error } = await userSupabase
      .from('saved_routes')
      .delete()
      .eq('user_id', user_id)
      .eq('route_id', id);

    if (error) {
      console.error('Error unsaving route:', error);
      return res.status(500).json({ error: 'Failed to unsave route', message: error.message });
    }

    res.status(204).send();
  } catch (error) {
    console.error('Error in DELETE /routes/:id/save:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

module.exports = router;
