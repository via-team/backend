const express = require('express');

const router = express.Router();

// POST /api/v1/routes  Body: title, description, start_label, end_label, start_time, end_time, tags[], points[]
router.post('/', (req, res) => {
  res.status(201).json({ route_id: '' });
});

// GET /api/v1/routes  Query: lat, lng, radius, dest_lat, dest_lng, tags, sort
router.get('/', (req, res) => {
  res.json({ data: [] });
});

// GET /api/v1/routes/:id
router.get('/:id', (req, res) => {
  res.json({});
});

// POST /api/v1/routes/:id/vote  Body: { vote_type, context }
router.post('/:id/vote', (req, res) => {
  res.status(201).json({});
});

// POST /api/v1/routes/:id/comments  Body: { content }
router.post('/:id/comments', (req, res) => {
  res.status(201).json({});
});

module.exports = router;
