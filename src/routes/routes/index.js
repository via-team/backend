/**
 * Route resource API: create, list, search, home feed, detail, votes, and comments.
 * Sub-routers are mounted in this order so `/feed` and `/search` are matched before the `/:id` param route.
 */
const express = require('express');

const createRouter = require('./create');
const listRouter = require('./list');
const searchRouter = require('./search');
const feedRouter = require('./feed');
const detailRouter = require('./detail');
const votesRouter = require('./votes');
const commentsRouter = require('./comments');

const router = express.Router();

router.use(createRouter);
router.use(listRouter);
router.use(searchRouter);
router.use(feedRouter);
router.use(detailRouter);
router.use(votesRouter);
router.use(commentsRouter);

module.exports = router;
