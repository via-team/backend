const rateLimit = require('express-rate-limit');

const { rateLimits, rateLimitWindowMs } = require('../config/security');

function createRateLimiter(limit) {
  return rateLimit({
    windowMs: rateLimitWindowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        error: 'Too many requests',
        message: 'Please try again later.',
      });
    },
  });
}

module.exports = {
  createEventRateLimit: createRateLimiter(rateLimits.createEvent),
  commentRateLimit: createRateLimiter(rateLimits.comment),
  verifySchoolEmailRateLimit: createRateLimiter(rateLimits.verifySchoolEmail),
  voteRateLimit: createRateLimiter(rateLimits.vote),
};
