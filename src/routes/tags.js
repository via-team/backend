const express = require('express');
const supabase = require('../config/supabase');

const router = express.Router();

/**
 * @swagger
 * /api/v1/tags:
 *   get:
 *     summary: List all route tags
 *     description: Returns every row from the tags lookup table, ordered by name. Public and cacheable; use for tag pickers and filters.
 *     tags: [Tags]
 *     responses:
 *       200:
 *         description: Tag objects (may be an empty array)
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 required:
 *                   - id
 *                   - name
 *                 properties:
 *                   id:
 *                     type: string
 *                     format: uuid
 *                   name:
 *                     type: string
 *                   category:
 *                     type: string
 *                     nullable: true
 *       500:
 *         description: Server error
 */
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('tags')
      .select('id, name, category')
      .order('name', { ascending: true });

    if (error) {
      console.error('Error fetching tags:', error);
      return res.status(500).json({
        error: 'Internal server error',
        message: error.message,
      });
    }

    return res.json(data ?? []);
  } catch (error) {
    console.error('GET /tags:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

module.exports = router;
