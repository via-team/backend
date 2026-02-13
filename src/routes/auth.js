const express = require('express');
const allowedEmailDomains = require('../config/allowedEmailDomains');

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
  const { email } = req.body;

  // Validate email is provided
  if (!email) {
    return res.status(400).json({
      allowed: false,
      message: 'Email is required'
    });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({
      allowed: false,
      message: 'Invalid email format'
    });
  }

  // Convert email to lowercase for case-insensitive comparison
  const normalizedEmail = email.toLowerCase();

  // Check if email ends with any of the allowed domains
  const isAllowed = allowedEmailDomains.some(domain => 
    normalizedEmail.endsWith(domain.toLowerCase())
  );

  if (isAllowed) {
    return res.json({
      allowed: true,
      message: 'Email verified successfully'
    });
  } else {
    return res.json({
      allowed: false,
      message: 'Email domain not allowed. Please use a valid school email address.'
    });
  }
});

module.exports = router;
