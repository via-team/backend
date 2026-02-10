const express = require('express');

const router = express.Router();

// POST /api/v1/auth/verify-school-email  Body: { email }
router.post('/verify-school-email', (req, res) => {
  res.json({});
});

module.exports = router;
