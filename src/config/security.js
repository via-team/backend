const DEFAULT_DEV_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:4173',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:4173',
  'http://127.0.0.1:5173',
];

const DEFAULT_JSON_BODY_LIMIT = '1mb';
const DEFAULT_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

function parseCommaSeparatedEnv(value) {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parsePositiveIntegerEnv(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseTrustProxy(value) {
  if (value === undefined || value === null || value === '') {
    return process.env.NODE_ENV === 'production' ? 1 : false;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === 'true') {
    return true;
  }

  if (normalized === 'false') {
    return false;
  }

  const parsed = Number.parseInt(normalized, 10);
  if (Number.isInteger(parsed) && parsed >= 0) {
    return parsed;
  }

  return value;
}

function getAllowedOrigins() {
  const configuredOrigins = parseCommaSeparatedEnv(process.env.ALLOWED_ORIGINS);

  if (configuredOrigins.length > 0) {
    return configuredOrigins;
  }

  if (process.env.NODE_ENV !== 'production') {
    return DEFAULT_DEV_ALLOWED_ORIGINS;
  }

  return [];
}

const allowedOrigins = getAllowedOrigins();
const allowedOriginsSet = new Set(allowedOrigins);

function isOriginAllowed(origin) {
  return !origin || allowedOriginsSet.has(origin);
}

function corsOptionsDelegate(req, callback) {
  callback(null, {
    origin: isOriginAllowed(req.header('Origin')),
    optionsSuccessStatus: 204,
  });
}

module.exports = {
  allowedOrigins,
  corsOptionsDelegate,
  isOriginAllowed,
  jsonBodyLimit: process.env.JSON_BODY_LIMIT || DEFAULT_JSON_BODY_LIMIT,
  rateLimitWindowMs: parsePositiveIntegerEnv(
    process.env.RATE_LIMIT_WINDOW_MS,
    DEFAULT_RATE_LIMIT_WINDOW_MS,
  ),
  rateLimits: {
    verifySchoolEmail: parsePositiveIntegerEnv(process.env.RATE_LIMIT_VERIFY_SCHOOL_EMAIL_MAX, 10),
    createEvent: parsePositiveIntegerEnv(process.env.RATE_LIMIT_CREATE_EVENT_MAX, 5),
    vote: parsePositiveIntegerEnv(process.env.RATE_LIMIT_VOTE_MAX, 30),
    comment: parsePositiveIntegerEnv(process.env.RATE_LIMIT_COMMENT_MAX, 10),
  },
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
};
