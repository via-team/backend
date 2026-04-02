const supabase = require('../config/supabase');

/**
 * Validates the Supabase JWT from the Authorization header and attaches
 * the authenticated user to req.user. Returns 401 for missing or invalid tokens.
 *
 * Usage: apply to any route that requires authentication.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Authentication required',
      message: 'Missing or malformed Authorization header. Expected: Bearer <token>',
    });
  }

  const token = authHeader.slice(7); // strip "Bearer "

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data?.user) {
    return res.status(401).json({
      error: 'Invalid token',
      message: 'The provided token is invalid or has expired.',
    });
  }

  req.user = data.user;
  req.token = token;
  next();
}

/**
 * Best-effort auth for public endpoints that can expose extra fields to the
 * authenticated owner. Missing or invalid tokens are treated as anonymous.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} _res
 * @param {import('express').NextFunction} next
 */
async function attachUserIfPresent(req, _res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.slice(7);
  const { data, error } = await supabase.auth.getUser(token);

  if (!error && data?.user) {
    req.user = data.user;
    req.token = token;
  }

  next();
}

module.exports = { requireAuth, attachUserIfPresent };
