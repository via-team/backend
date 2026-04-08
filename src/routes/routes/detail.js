const express = require('express');
const supabase = require('../../config/supabase');
const { requireAuth, attachUserIfPresent } = require('../../middleware/auth');
const { validateBody } = require('../../middleware/validate');
const { UpdateRouteSchema, RegisterRouteImageSchema } = require('../../schemas/routes');
const { buildRouteDetailResponse } = require('../../services/routeDetail');

const router = express.Router();

function normaliseOptionalText(value) {
  return value === '' ? null : value;
}

/**
 * @swagger
 * /api/v1/routes/{id}:
 *   get:
 *     summary: Get specific route
 *     description: >
 *       Get the full route object including all GPS points and tags. Geo-tagged notes are available
 *       separately via `GET /api/v1/routes/{id}/notes`.
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
/**
 * @swagger
 * /api/v1/routes/{id}/images:
 *   post:
 *     summary: Register a route photo after client upload to storage
 *     tags: [Routes]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/:id/images',
  requireAuth,
  validateBody(RegisterRouteImageSchema),
  async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const userSupabase = supabase.createUserClient(req.token);
      const { public_url, storage_path, sort_order } = req.body;

      const { data: route, error: fetchError } = await supabase
        .from('routes')
        .select('id, creator_id, is_active')
        .eq('id', id)
        .single();

      if (fetchError || !route || !route.is_active) {
        return res.status(404).json({
          error: 'Route not found',
          message: `No active route found with id ${id}`,
        });
      }

      if (route.creator_id !== userId) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Only the route creator can add route images',
        });
      }

      const { data: row, error: insertError } = await userSupabase
        .from('route_images')
        .insert({
          route_id: id,
          public_url,
          storage_path,
          sort_order: sort_order ?? 0,
          created_by: userId,
        })
        .select('id, public_url, sort_order')
        .single();

      if (insertError || !row) {
        console.error('Error inserting route_images:', insertError);
        return res.status(500).json({
          error: 'Failed to save route image',
          message: insertError?.message ?? 'Unknown database error',
        });
      }

      return res.status(201).json(row);
    } catch (error) {
      console.error('Error in POST /routes/:id/images:', error);
      return res.status(500).json({
        error: 'Internal server error',
        message: error.message,
      });
    }
  },
);

router.get('/:id', attachUserIfPresent, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id ?? null;
    const savedRoutesSupabase = userId && req.token ? supabase.createUserClient(req.token) : supabase;

    const result = await buildRouteDetailResponse(supabase, id, {
      userId,
      savedRoutesSupabase,
    });

    if (!result.ok) {
      return res.status(result.status).json(result.error);
    }

    return res.json(result.body);
  } catch (error) {
    console.error('Error in GET /routes/:id:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/v1/routes/{id}:
 *   patch:
 *     summary: Update a route's editable fields
 *     description: >
 *       Route creators can update their own `title` and public `description`.
 *       At least one field must be provided. An empty string for `description` is stored as `null`.
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
 *             properties:
 *               title:
 *                 type: string
 *                 example: "Quieter walk to GDC"
 *               description:
 *                 type: string
 *                 nullable: true
 *                 example: "Cuts behind the library and avoids Speedway."
 *     responses:
 *       200:
 *         description: Route updated successfully
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
 *                   nullable: true
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Route not found
 *       500:
 *         description: Internal server error
 */
router.patch('/:id', requireAuth, validateBody(UpdateRouteSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userSupabase = supabase.createUserClient(req.token);

    const { data: route, error: fetchError } = await supabase
      .from('routes')
      .select('id, creator_id, is_active')
      .eq('id', id)
      .single();

    if (fetchError || !route || !route.is_active) {
      return res.status(404).json({
        error: 'Route not found',
        message: `No active route found with id ${id}`,
      });
    }

    if (route.creator_id !== userId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You can only update routes you created',
      });
    }

    const updates = {};

    if (Object.prototype.hasOwnProperty.call(req.body, 'title')) {
      updates.title = req.body.title;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'description')) {
      updates.description = normaliseOptionalText(req.body.description);
    }

    let updatedRoute;

    if (Object.keys(updates).length > 0) {
      const { data, error: updateError } = await userSupabase
        .from('routes')
        .update(updates)
        .eq('id', id)
        .eq('is_active', true)
        .select('id, title, description')
        .single();

      if (updateError || !data) {
        console.error('Error updating route:', updateError);
        return res.status(500).json({
          error: 'Failed to update route',
          message: updateError?.message ?? 'Unknown database error',
        });
      }

      updatedRoute = data;
    } else {
      const { data, error: fetchError } = await supabase
        .from('routes')
        .select('id, title, description')
        .eq('id', id)
        .single();

      if (fetchError || !data) {
        return res.status(404).json({ error: 'Route not found' });
      }

      updatedRoute = data;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'tags')) {
      const { error: deleteError } = await userSupabase
        .from('route_tags')
        .delete()
        .eq('route_id', id);

      if (deleteError) {
        console.error('Error clearing route tags:', deleteError);
        return res.status(500).json({
          error: 'Failed to update tags',
          message: deleteError.message,
        });
      }

      if (req.body.tags.length > 0) {
        const { error: insertError } = await userSupabase
          .from('route_tags')
          .insert(req.body.tags.map((tagId) => ({ route_id: id, tag_id: tagId })));

        if (insertError) {
          console.error('Error inserting route tags:', insertError);
          return res.status(500).json({
            error: 'Failed to update tags',
            message: insertError.message,
          });
        }
      }

      const { data: tagRows } = await userSupabase
        .from('route_tags')
        .select('tags(name)')
        .eq('route_id', id);

      updatedRoute.tags = (tagRows ?? []).map((r) => r.tags?.name).filter(Boolean);
    }

    res.json(updatedRoute);
  } catch (error) {
    console.error('Error in PATCH /routes/:id:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/v1/routes/{id}:
 *   delete:
 *     summary: Deactivate a route
 *     description: >
 *       Soft-deletes a route by setting `is_active = false`. Only the original route creator can
 *       deactivate their own route.
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
 *     responses:
 *       200:
 *         description: Route deactivated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Route not found or already inactive
 *       500:
 *         description: Internal server error
 */
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userSupabase = supabase.createUserClient(req.token);

    // Anon client: active routes are publicly readable; avoids JWT SELECT gaps on `routes`.
    const { data: route, error: fetchError } = await supabase
      .from('routes')
      .select('id, creator_id, is_active')
      .eq('id', id)
      .single();

    if (fetchError || !route || !route.is_active) {
      return res.status(404).json({
        error: 'Route not found',
        message: `No active route found with id ${id}`,
      });
    }

    if (route.creator_id !== userId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You can only delete routes you created',
      });
    }

    const updateClient = supabase.getServiceRoleClient?.() || userSupabase;
    const { data: deactivated, error: updateError } = await updateClient
      .from('routes')
      .update({ is_active: false })
      .eq('id', id)
      .eq('is_active', true)
      .select('id')
      .single();

    if (updateError) {
      console.error('Error deactivating route:', updateError);
      const code = updateError.code;
      const msg = String(updateError.message || '').toLowerCase();
      const looksLikeRls =
        code === '42501' ||
        msg.includes('permission denied') ||
        msg.includes('row-level security') ||
        msg.includes('rls') ||
        msg.includes('policy');
      if (looksLikeRls) {
        return res.status(403).json({
          error: 'Forbidden',
          message:
            'Could not deactivate this route. Row-level security blocked the update — ensure UPDATE on `routes` allows the creator to set `is_active` to false (see backend/docs/sql/fix_routes_soft_delete_rls.sql).',
          details: updateError.message,
        });
      }
      return res.status(500).json({
        error: 'Failed to deactivate route',
        message: updateError.message,
      });
    }

    if (!deactivated) {
      return res.status(404).json({
        error: 'Route not found',
        message: `No active route found with id ${id}`,
      });
    }

    res.json({ message: 'Route deactivated successfully' });
  } catch (error) {
    console.error('Error in DELETE /routes/:id:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
});

module.exports = router;
