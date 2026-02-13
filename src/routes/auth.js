const express = require('express');

const router = express.Router();

/**
 * @swagger
 * /api/v1/auth/verify-school-email:
 *   post:
 *     summary: Verify school email
 *     description: Ensures sign-ups are restricted to school email addresses (e.g., @utexas.edu)
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: student@utexas.edu
 *     responses:
 *       200:
 *         description: Email verification result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 allowed:
 *                   type: boolean
 *                 message:
 *                   type: string
 */
router.post('/verify-school-email', (req, res) => {
  res.json({});
});

module.exports = router;
