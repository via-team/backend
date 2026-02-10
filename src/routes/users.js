const express = require('express');

const router = express.Router();

// GET /api/v1/users/me
router.get('/me', (req, res) => {
  res.json({});
});

// POST /api/v1/users/friends/request  Body: { friend_id }
router.post('/friends/request', (req, res) => {
  res.status(201).json({});
});

module.exports = router;
