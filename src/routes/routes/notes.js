const express = require('express');
const supabase = require('../../config/supabase');
const { requireAuth } = require('../../middleware/auth');
const { validateBody } = require('../../middleware/validate');
const { CreateRouteNoteSchema, UpdateRouteNoteSchema } = require('../../schemas/routes');

const router = express.Router();

async function fetchActiveRoute(id) {
  const { data, error } = await supabase
    .from('routes')
    .select('id, creator_id, is_active')
    .eq('id', id)
    .single();
  if (error || !data || !data.is_active) return null;
  return data;
}

/**
 * @swagger
 * /api/v1/routes/{id}/notes:
 *   get:
 *     summary: List notes for a route
 *     description: >
 *       Returns all geo-tagged notes attached to a route, ordered by creation time ascending.
 *       No authentication required — notes are publicly visible.
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
 *         description: List of notes
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                     format: uuid
 *                   content:
 *                     type: string
 *                   lat:
 *                     type: number
 *                     format: float
 *                   lng:
 *                     type: number
 *                     format: float
 *                   author_id:
 *                     type: string
 *                     format: uuid
 *                   created_at:
 *                     type: string
 *                     format: date-time
 *                   updated_at:
 *                     type: string
 *                     format: date-time
 *                     nullable: true
 *       404:
 *         description: Route not found
 *       500:
 *         description: Internal server error
 */
router.get('/:id/notes', async (req, res) => {
  try {
    const { id } = req.params;

    const route = await fetchActiveRoute(id);
    if (!route) {
      return res.status(404).json({
        error: 'Route not found',
        message: `No active route found with id ${id}`,
      });
    }

    const { data: notes, error } = await supabase.rpc('get_route_notes', { p_route_id: id });

    if (error) {
      console.error('Error fetching route notes:', error);
      return res.status(500).json({
        error: 'Failed to fetch notes',
        message: error.message,
      });
    }

    res.json(notes ?? []);
  } catch (error) {
    console.error('Error in GET /routes/:id/notes:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * @swagger
 * /api/v1/routes/{id}/notes:
 *   post:
 *     summary: Add a note to a route
 *     description: >
 *       Creates a new geo-tagged note on a route. Only the route creator can add notes.
 *       The coordinate (`lat`, `lng`) should be a point snapped to the route path.
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
 *               - lat
 *               - lng
 *             properties:
 *               content:
 *                 type: string
 *                 example: "Watch your step here — loose pavement"
 *               lat:
 *                 type: number
 *                 format: float
 *                 example: 30.2849
 *               lng:
 *                 type: number
 *                 format: float
 *                 example: -97.7341
 *     responses:
 *       201:
 *         description: Note created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   format: uuid
 *                 content:
 *                   type: string
 *                 lat:
 *                   type: number
 *                   format: float
 *                 lng:
 *                   type: number
 *                   format: float
 *                 author_id:
 *                   type: string
 *                   format: uuid
 *                 created_at:
 *                   type: string
 *                   format: date-time
 *                 updated_at:
 *                   type: string
 *                   nullable: true
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — caller is not the route creator
 *       404:
 *         description: Route not found
 *       500:
 *         description: Internal server error
 */
router.post('/:id/notes', requireAuth, validateBody(CreateRouteNoteSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const { content, lat, lng } = req.body;
    const userId = req.user.id;

    const route = await fetchActiveRoute(id);
    if (!route) {
      return res.status(404).json({
        error: 'Route not found',
        message: `No active route found with id ${id}`,
      });
    }

    if (route.creator_id !== userId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only the route creator can add notes',
      });
    }

    const { data: noteId, error: rpcError } = await supabase.rpc(
      'create_route_note_with_geography',
      {
        p_route_id: id,
        p_author_id: userId,
        p_content: content,
        p_lat: lat,
        p_lng: lng,
      },
    );

    if (rpcError || !noteId) {
      console.error('Error creating route note:', rpcError);
      return res.status(500).json({
        error: 'Failed to create note',
        message: rpcError?.message ?? 'Unknown database error',
      });
    }

    const { data: notes, error: fetchError } = await supabase.rpc('get_route_notes', {
      p_route_id: id,
    });

    const created = (notes ?? []).find((n) => n.id === noteId);

    if (fetchError || !created) {
      return res.status(201).json({ id: noteId });
    }

    res.status(201).json(created);
  } catch (error) {
    console.error('Error in POST /routes/:id/notes:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * @swagger
 * /api/v1/routes/{id}/notes/{noteId}:
 *   patch:
 *     summary: Edit a route note
 *     description: Updates the text content of a note. Only the route creator can edit notes.
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
 *       - in: path
 *         name: noteId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Note ID
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
 *                 example: "Repaired — safe to cross now"
 *     responses:
 *       200:
 *         description: Note updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   format: uuid
 *                 content:
 *                   type: string
 *                 lat:
 *                   type: number
 *                   format: float
 *                 lng:
 *                   type: number
 *                   format: float
 *                 author_id:
 *                   type: string
 *                   format: uuid
 *                 created_at:
 *                   type: string
 *                   format: date-time
 *                 updated_at:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Route or note not found
 *       500:
 *         description: Internal server error
 */
router.patch(
  '/:id/notes/:noteId',
  requireAuth,
  validateBody(UpdateRouteNoteSchema),
  async (req, res) => {
    try {
      const { id, noteId } = req.params;
      const { content } = req.body;
      const userId = req.user.id;

      const route = await fetchActiveRoute(id);
      if (!route) {
        return res.status(404).json({
          error: 'Route not found',
          message: `No active route found with id ${id}`,
        });
      }

      if (route.creator_id !== userId) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Only the route creator can edit notes',
        });
      }

      const { data: updatedNote, error: updateError } = await supabase
        .from('route_notes')
        .update({ content, updated_at: new Date().toISOString() })
        .eq('id', noteId)
        .eq('route_id', id)
        .select('id, route_id, author_id, content, created_at, updated_at')
        .single();

      if (updateError || !updatedNote) {
        if (updateError?.code === 'PGRST116' || !updatedNote) {
          return res.status(404).json({
            error: 'Note not found',
            message: `No note found with id ${noteId} on route ${id}`,
          });
        }
        console.error('Error updating route note:', updateError);
        return res.status(500).json({
          error: 'Failed to update note',
          message: updateError?.message ?? 'Unknown database error',
        });
      }

      res.json(updatedNote);
    } catch (error) {
      console.error('Error in PATCH /routes/:id/notes/:noteId:', error);
      res.status(500).json({ error: 'Internal server error', message: error.message });
    }
  },
);

/**
 * @swagger
 * /api/v1/routes/{id}/notes/{noteId}:
 *   delete:
 *     summary: Delete a route note
 *     description: Permanently deletes a note. Only the route creator can delete notes.
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
 *       - in: path
 *         name: noteId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Note ID
 *     responses:
 *       204:
 *         description: Note deleted successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Route or note not found
 *       500:
 *         description: Internal server error
 */
router.delete('/:id/notes/:noteId', requireAuth, async (req, res) => {
  try {
    const { id, noteId } = req.params;
    const userId = req.user.id;

    const route = await fetchActiveRoute(id);
    if (!route) {
      return res.status(404).json({
        error: 'Route not found',
        message: `No active route found with id ${id}`,
      });
    }

    if (route.creator_id !== userId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only the route creator can delete notes',
      });
    }

    const { data: deleted, error: deleteError } = await supabase
      .from('route_notes')
      .delete()
      .eq('id', noteId)
      .eq('route_id', id)
      .select('id')
      .single();

    if (deleteError || !deleted) {
      if (deleteError?.code === 'PGRST116' || !deleted) {
        return res.status(404).json({
          error: 'Note not found',
          message: `No note found with id ${noteId} on route ${id}`,
        });
      }
      console.error('Error deleting route note:', deleteError);
      return res.status(500).json({
        error: 'Failed to delete note',
        message: deleteError?.message ?? 'Unknown database error',
      });
    }

    res.status(204).send();
  } catch (error) {
    console.error('Error in DELETE /routes/:id/notes/:noteId:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

module.exports = router;
