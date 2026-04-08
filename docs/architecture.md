# Architecture

## Overview

VIA's backend is a RESTful API built with **Node.js + Express**. It connects to a **Supabase** project (managed PostgreSQL with PostGIS) and exposes versioned endpoints under `/api/v1/`. Interactive documentation is served at `/api-docs` via Swagger UI.

```
Client
  │
  ▼
Express Server (src/index.js)
  │
  ├── /api-docs        ← Swagger UI (auto-generated from JSDoc)
  ├── /health          ← Health check
  │
  └── /api/v1/
        ├── auth/      ← src/routes/auth.js         (public)
        ├── users/     ← requireAuth → src/routes/users.js
        └── routes/    ← src/routes/routes/ (see index.js)
              ├── GET  /          (public)
              ├── POST /          requireAuth
              ├── GET  /feed      (public; friends tab → requireAuth)
              ├── GET  /:id       (public)
              ├── POST /:id/vote  requireAuth
              └── POST /:id/comments  requireAuth
                │
                ▼
           Auth Middleware (src/middleware/auth.js)
                │
                ▼
           Supabase Client (src/config/supabase.js)
                │
                ▼
           Supabase (PostgreSQL + PostGIS)
```

## Tech stack

| Layer | Technology | Purpose |
|---|---|---|
| Runtime | Node.js (v18+) | JavaScript server runtime |
| Web framework | Express.js | HTTP routing and middleware |
| Database | Supabase (PostgreSQL) | Persistent storage |
| Geographic data | PostGIS (via Supabase) | Spatial queries on routes and points |
| Supabase client | `@supabase/supabase-js` | Database interaction |
| API docs | swagger-jsdoc + swagger-ui-express | Auto-generated OpenAPI 3.0 docs |
| Config | dotenv | Environment variable loading |
| Security middleware | helmet + cors + express-rate-limit | HTTP headers, browser origin allow-list, and abuse controls |
| Dev tooling | nodemon | Auto-restart during development |

## Directory structure

```
backend/
├── src/
│   ├── index.js                   # App entry point — registers middleware, routes, starts server
│   ├── config/
│   │   ├── supabase.js            # Supabase client singleton
│   │   ├── swagger.js             # Swagger/OpenAPI spec configuration
│   │   └── allowedEmailDomains.js # Whitelist of accepted school email domains
│   ├── middleware/
│   │   ├── auth.js                # JWT auth middleware (requireAuth)
│   │   └── requireAuthForFriendsFeed.js  # Optional auth for GET /routes/feed?tab=friends
│   ├── routes/
│   │   ├── auth.js                # Authentication endpoints
│   │   ├── users.js               # User profile and social endpoints
│   │   └── routes/                # Route CRUD, list, feed, votes, comments (composed in index.js)
│   └── services/
│       ├── routeList.js           # List/feed enrichment, nearby IDs, polylines
│       ├── routeLocation.js       # Optional PostGIS location filter for list + feed
│       ├── voteStats.js           # Vote aggregation for detail + vote endpoints
│       └── friends.js             # Friend ID extraction for friends feed
├── docs/                          # This documentation
├── test-routes-get.sh             # Manual test script for route endpoints
├── test-users-me.sh               # Manual test script for user endpoint
├── package.json
└── .env                           # Local environment variables (never commit)
```

## Request lifecycle

1. Client sends an HTTP request.
2. `helmet()` sets baseline security headers on the response.
3. Browser requests are checked against the configured CORS allow-list before route handlers run. Requests without an `Origin` header (for example, server-to-server calls, curl, and many tests) continue normally.
4. `cors(...)` reflects allowed origins and handles browser preflight requests.
5. `express.json({ limit })` parses JSON request bodies with an explicit size cap (`JSON_BODY_LIMIT`, default `1mb`).
6. For protected endpoints, `requireAuth` (`src/middleware/auth.js`) validates the `Authorization: Bearer <token>` header by calling `supabase.auth.getUser(token)`. On success, the authenticated user is attached to `req.user`. On failure, a `401` response is returned immediately.
7. Rate-limit middleware protects abuse-prone write endpoints before the route handler reaches Supabase.
8. The matching route handler (in `src/routes/`) is called.
9. The handler validates inputs, calls the Supabase client, and returns a JSON response.

## Authentication middleware

`src/middleware/auth.js` exports `requireAuth`, an Express middleware that:

- Reads the `Authorization` header and expects the format `Bearer <token>`.
- Calls `supabase.auth.getUser(token)` to validate the Supabase JWT.
- Attaches the verified user object to `req.user` (includes `req.user.id`, `req.user.email`, etc.).
- Returns `401 Authentication required` if the header is absent or malformed.
- Returns `401 Invalid token` if the token is expired or unrecognised.

**Protected endpoints:**
- All `/api/v1/users/*` routes
- `POST /api/v1/routes`
- `POST /api/v1/routes/:id/vote`
- `POST /api/v1/routes/:id/comments`
- `POST /api/v1/events`

## Security middleware

The middleware stack in `src/index.js` now applies a small production-hardening baseline before any routes are mounted:

- `app.set('trust proxy', ...)` uses `TRUST_PROXY` when provided. If unset, it defaults to `1` in production and `false` elsewhere. Set this correctly when deploying behind Render or another reverse proxy so IP-based rate limiting sees the real client IP.
- `helmet()` adds common security headers such as `X-Content-Type-Options` and `Cross-Origin-Opener-Policy`.
- CORS uses an `ALLOWED_ORIGINS` allow-list. When `ALLOWED_ORIGINS` is unset outside production, common localhost frontend origins are allowed by default for local development. In production, leaving `ALLOWED_ORIGINS` unset blocks browser origins rather than falling back to `*`.
- `express.json({ limit: ... })` uses `JSON_BODY_LIMIT` (default `1mb`) so large uploads fail fast instead of leaving the parser effectively unbounded.

**Rate-limited endpoints:**
- `POST /api/v1/auth/verify-school-email`
- `POST /api/v1/events`
- `POST /api/v1/routes/:id/vote`
- `POST /api/v1/routes/:id/comments`

## Configuration

All configuration is driven by environment variables loaded with `dotenv` at startup (`require('dotenv').config()` in `index.js`).

| Variable | Used in | Purpose |
|---|---|---|
| `PORT` | `index.js` | HTTP listen port (default: `3000`) |
| `SUPABASE_URL` | `config/supabase.js` | Supabase project URL |
| `SUPABASE_ANON_KEY` | `config/supabase.js` | Supabase anonymous/public API key |
| `SUPABASE_SERVICE_ROLE_KEY` (optional) | `config/supabase.js` | Used only for trusted soft-delete updates after Express checks `creator_id`; bypasses RLS if user JWT updates fail |
| `ALLOWED_ORIGINS` | `config/security.js` | Comma-separated browser origin allow-list (for example: `https://via.example.com,http://localhost:5173`) |
| `JSON_BODY_LIMIT` | `config/security.js` | `express.json()` payload cap (default: `1mb`) |
| `TRUST_PROXY` | `config/security.js` | Express `trust proxy` setting for deployments behind a reverse proxy |
| `RATE_LIMIT_WINDOW_MS` | `config/security.js` | Shared rate-limit window in milliseconds (default: `600000`) |
| `RATE_LIMIT_VERIFY_SCHOOL_EMAIL_MAX` | `config/security.js` | Max `POST /api/v1/auth/verify-school-email` requests per window (default: `10`) |
| `RATE_LIMIT_CREATE_EVENT_MAX` | `config/security.js` | Max `POST /api/v1/events` requests per window (default: `5`) |
| `RATE_LIMIT_VOTE_MAX` | `config/security.js` | Max `POST /api/v1/routes/:id/vote` requests per window (default: `30`) |
| `RATE_LIMIT_COMMENT_MAX` | `config/security.js` | Max `POST /api/v1/routes/:id/comments` requests per window (default: `10`) |

## Supabase client

`src/config/supabase.js` exports a single Supabase client instance created with the `anon` key. All route handlers import this singleton directly:

```javascript
const supabase = require('../config/supabase');
```

The anon key gives access according to Supabase Row Level Security (RLS) policies defined in the dashboard. For write operations that need elevated access, the service role key would be required (not currently used). Database schema changes, RLS updates, and SQL function changes are managed directly in Supabase rather than from migration files in this repository.

## Geographic data

Routes and their GPS points are stored with PostGIS geography types in Supabase. Because the Supabase JS client doesn't natively handle PostGIS types, two database-side **RPC functions** are used for writes:

- `create_route_with_geography` — inserts a route row and converts coordinate pairs to a PostGIS `geography` column.
- `insert_route_points` — bulk-inserts GPS point records with PostGIS geography types.

Read queries use standard `supabase.from(...).select(...)` calls; PostGIS types are returned as text/GeoJSON by Supabase automatically.

Distance along a route is summed **server-side** in JavaScript using the **Haversine formula** in `src/utils/geo.js` (used when creating a route) before the distance is stored.

## API versioning

All endpoints are prefixed with `/api/v1/`. The version segment allows breaking changes to be introduced under a new version prefix without affecting existing clients.

## API documentation (Swagger)

Swagger documentation is auto-generated from JSDoc comments in the route files using `swagger-jsdoc`. The configuration lives in `src/config/swagger.js`. When the server is running, the interactive UI is available at:

```
http://localhost:3000/api-docs
```

To document a new endpoint, add an `@swagger` JSDoc block above the route handler — see existing routes for examples.

**Swagger UI URLs:**
- **Production:** https://via-backend-2j3d.onrender.com/api-docs
- **Local:** http://localhost:3000/api-docs
