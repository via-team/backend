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
        ├── auth/      ← src/routes/auth.js
        ├── users/     ← src/routes/users.js
        └── routes/    ← src/routes/routes.js
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
│   └── routes/
│       ├── auth.js                # Authentication endpoints
│       ├── users.js               # User profile and social endpoints
│       └── routes.js              # Route creation, listing, voting, comments
├── docs/                          # This documentation
├── test-routes-get.sh             # Manual test script for route endpoints
├── test-users-me.sh               # Manual test script for user endpoint
├── package.json
└── .env                           # Local environment variables (never commit)
```

## Request lifecycle

1. Client sends an HTTP request.
2. `express.json()` parses the JSON body.
3. The matching route handler (in `src/routes/`) is called.
4. The handler validates inputs, calls the Supabase client, and returns a JSON response.

There is currently **no authentication middleware** in the request pipeline. JWT-based middleware is planned — see [Contributing → Roadmap](./contributing.md#roadmap).

## Configuration

All configuration is driven by environment variables loaded with `dotenv` at startup (`require('dotenv').config()` in `index.js`).

| Variable | Used in | Purpose |
|---|---|---|
| `PORT` | `index.js` | HTTP listen port (default: `3000`) |
| `SUPABASE_URL` | `config/supabase.js` | Supabase project URL |
| `SUPABASE_ANON_KEY` | `config/supabase.js` | Supabase anonymous/public API key |

## Supabase client

`src/config/supabase.js` exports a single Supabase client instance created with the `anon` key. All route handlers import this singleton directly:

```javascript
const supabase = require('../config/supabase');
```

The anon key gives access according to Supabase Row Level Security (RLS) policies defined in the dashboard. For write operations that need elevated access, the service role key would be required (not currently used).

## Geographic data

Routes and their GPS points are stored with PostGIS geography types in Supabase. Because the Supabase JS client doesn't natively handle PostGIS types, two database-side **RPC functions** are used for writes:

- `create_route_with_geography` — inserts a route row and converts coordinate pairs to a PostGIS `geography` column.
- `insert_route_points` — bulk-inserts GPS point records with PostGIS geography types.

Read queries use standard `supabase.from(...).select(...)` calls; PostGIS types are returned as text/GeoJSON by Supabase automatically.

Distance between two coordinates is also calculated **server-side** in JavaScript using the **Haversine formula** (in `src/routes/routes.js`) before the route is stored.

## API versioning

All endpoints are prefixed with `/api/v1/`. The version segment allows breaking changes to be introduced under a new version prefix without affecting existing clients.

## API documentation (Swagger)

Swagger documentation is auto-generated from JSDoc comments in the route files using `swagger-jsdoc`. The configuration lives in `src/config/swagger.js`. When the server is running, the interactive UI is available at:

```
http://localhost:3000/api-docs
```

To document a new endpoint, add an `@swagger` JSDoc block above the route handler — see existing routes for examples.
