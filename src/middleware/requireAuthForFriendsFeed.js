const { requireAuth } = require('./auth');

/**
 * Home feed allows anonymous access for `tab=top` and `tab=new`.
 * `tab=friends` requires a valid Bearer token so we can load the user's graph.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function requireAuthForFriendsFeed(req, res, next) {
  if (req.query.tab === 'friends') {
    return requireAuth(req, res, next);
  }
  next();
}

module.exports = { requireAuthForFriendsFeed };
