# Contributing

## Development workflow

1. **Branch off `main`** for every piece of work.
   ```bash
   git checkout -b feat/my-feature   # new feature
   git checkout -b fix/bug-name      # bug fix
   ```
2. Make your changes (see [Code conventions](#code-conventions) below).
3. Test manually with the shell scripts or curl (see [Getting Started](./getting-started.md)).
4. Open a pull request targeting `main`.

## Code conventions

### Adding a new endpoint

1. Identify the correct router file:
   - Authentication logic → `src/routes/auth.js`
   - User profile / social → `src/routes/users.js`
   - Route data → `src/routes/routes.js`
   - New domain → create `src/routes/<domain>.js` and register it in `src/index.js`

2. Write the handler. Follow the existing pattern:
   ```javascript
   router.post('/endpoint', async (req, res) => {
     try {
       // 1. Extract and validate inputs
       // 2. Call Supabase
       // 3. Transform and return response
     } catch (error) {
       console.error('Context:', error);
       res.status(500).json({ error: 'Internal server error', message: error.message });
     }
   });
   ```

3. Add a `@swagger` JSDoc block above the handler. The Swagger UI at `/api-docs` auto-regenerates on server restart. Use the existing routes as templates.

4. Document the endpoint in [api-reference.md](./api-reference.md).

### Error responses

All error responses should follow the project-wide format:
```json
{
  "error": "Short machine-readable label",
  "message": "Human-readable explanation"
}
```
Include a `details` field (the Supabase/database error message) when it helps debugging, but strip it before any public-facing production deployment.

### Authentication middleware

- Import `requireAuth` from `src/middleware/auth.js` for any endpoint that requires a logged-in user.
- Add it as a per-route middleware argument: `router.post('/endpoint', requireAuth, async (req, res) => { ... })`.
- Inside the handler, access the authenticated user via `req.user.id` (UUID), `req.user.email`, etc.
- Document protected endpoints in [api-reference.md](./api-reference.md) with the required header and a `401` response entry.

### Supabase queries

- Import the shared client: `const supabase = require('../config/supabase');`
- Always destructure `{ data, error }` and check `error` before using `data`.
- For writes involving PostGIS `geography` columns, use `supabase.rpc(...)` — the JS client cannot construct geography types directly (see [Database → RPC functions](./database.md#rpc-functions)).

### Environment variables

- Never hard-code credentials or URLs. Add new variables to `.env` and document them in [Getting Started → Environment variables](./getting-started.md#3-configure-environment-variables) and in [Architecture → Configuration](./architecture.md#configuration).

## Roadmap

These features have stubs/TODOs in the codebase and are the next areas to implement.

### High priority

#### 1. ~~JWT authentication middleware~~ ✓ Implemented

`src/middleware/auth.js` exports `requireAuth`, which validates the Supabase JWT from the `Authorization: Bearer <token>` header, attaches `req.user` to the request, and returns `401` for missing or invalid tokens.

Applied to:
- All `/api/v1/users/*` routes (via `index.js`)
- `POST /api/v1/routes` (inline in `routes.js`)
- `POST /api/v1/routes/:id/vote` (inline in `routes.js`)
- `POST /api/v1/routes/:id/comments` (inline in `routes.js`)

#### 2. ~~`GET /api/v1/routes/:id`~~ ✓ Implemented

Returns the full route object including all GPS points, tags, and vote statistics.

Fetches the route with `route_points(*)` and `route_tags(tags(name))`, then makes a second query to the `votes` table to compute `avg_rating` and `vote_count`. Points are sorted by `sequence` and returned as `{ seq, lat, lng, accuracy_meters, recorded_at }`. Returns `404` when the route does not exist or `is_active` is false.

#### 3. ~~`POST /api/v1/routes/:id/vote`~~ ✓ Implemented

Records an up/down vote with a context category (`safety`, `efficiency`, `scenery`) in the `votes` table.

One vote per user per route — implemented as an upsert on `(route_id, user_id)` so re-voting replaces the previous vote. Returns updated vote totals (`vote_count`, `upvotes`, `downvotes`, `avg_rating`) in the `201` response.

#### 4. ~~`POST /api/v1/routes/:id/comments`~~ ✓ Implemented

Inserts a row in the `comments` table. Validates that `content` is non-empty, verifies the route exists and is active, then inserts `{ route_id, user_id, content }`. Returns the full comment record (`comment_id`, `route_id`, `user_id`, `content`, `created_at`) in the `201` response.

#### 5. `POST /api/v1/users/friends/request` *(deferred)*

> **On hold** — the team is still debating the exact semantics and relationships for the social graph (unidirectional follow vs. mutual friendship, blocking, privacy, etc.). The stub endpoint and `friends` table exist but no logic is implemented. Revisit once the product design is settled.

### Medium priority

#### 6. ~~Location-based filtering in `GET /api/v1/routes`~~ ✓ Implemented

When `lat` and `lng` query parameters are provided, the handler calls the `get_routes_near` Supabase RPC, which uses PostGIS `ST_DWithin` on the `start_point` geography column to restrict results to routes starting within `radius` metres (default `500`) of the supplied coordinate. An empty result set is returned immediately when no routes match, avoiding an unnecessary full-table fetch.

The `dest_lat` / `dest_lng` parameters are still accepted but not yet used — filtering by destination proximity is tracked under *Lower priority* below.

New Supabase RPC required (see [Database → RPC functions → `get_routes_near`](./database.md#get_routes_near)).

#### 7. ~~`preview_polyline`~~ ✓ Implemented

`GET /api/v1/routes` now returns a real `preview_polyline` string for every route instead of `null`.

After fetching routes, the handler fires one `get_route_points_with_coords` RPC call per route **in parallel** (via a single `Promise.all`). Each point set is downsampled to at most 20 evenly-spaced points with `samplePoints()`, then encoded as a **Google Encoded Polyline** string by `encodePolyline()` — both helpers live in `src/utils/geo.js`. If a route has no stored points the field remains `null`.

The votes query was also moved into the same `Promise.all`, so votes and points are now fetched concurrently rather than sequentially, cutting a round-trip off the hot path.

No new RPC or schema change was required.

#### 8. Input validation middleware

Replace per-handler validation with a shared validation layer (e.g. `express-validator` or `zod`) to reduce boilerplate and standardise `400` error shapes.

### Lower priority / nice-to-have

- Pagination for `GET /api/v1/routes` (currently hard-capped at 100).
- `GET /api/v1/routes/:id/comments` — list comments on a route.
- Destination-proximity filtering using `dest_lat` / `dest_lng` + `ST_DWithin` on `end_point`.
- Rate limiting (e.g. `express-rate-limit`) to protect public endpoints.
- Centralised error handler middleware to remove repeated `try/catch` blocks.
- `.env.example` file checked into the repo so contributors know which variables are needed.
- **`get_route_points_bulk` RPC** — a single Postgres function that accepts an array of route UUIDs and returns all their points in one round-trip, eliminating the N-per-route parallel calls introduced for `preview_polyline`.

---

## Ideas & future improvements

Brainstormed directions that could meaningfully improve the backend. None of these are scoped yet — they are starting points for discussion.

### API surface

- **`GET /api/v1/routes/:id/comments`** — the `comments` table is populated but there is no read endpoint. Add with optional `?limit` and `?cursor` pagination.
- **`DELETE /api/v1/routes/:id`** — soft-delete (flip `is_active = false`) for route creators; guards the creator's `user_id` check against `req.user.id`.
- **`GET /api/v1/tags`** — expose the `tags` lookup table so clients can render a tag picker without hard-coding values.
- **`POST /api/v1/routes/:id/save`** — insert a `route_usage` row with `started_at = now()` to let users bookmark routes; mirrors how `stats.routes_saved` is counted.
- **`GET /api/v1/users/:id/routes`** — public profile route listing filtered by `creator_id`, respecting `is_active`.

### Performance

- **~~Parallel DB calls in `GET /api/v1/routes`~~** ✓ Done — votes and per-route point fetches now run inside a single `Promise.all`, so they execute concurrently rather than sequentially.
- **`get_route_points_bulk` RPC** — a single Postgres function that accepts an array of route UUIDs and returns all their decoded points in one round-trip, replacing the N parallel `get_route_points_with_coords` calls introduced for `preview_polyline`. Particularly valuable when the list returns many routes.
- **Database-level vote aggregation** — move the `avg_rating` / `upvotes` / `downvotes` calculation into a Postgres view or computed column so the Express layer stops pulling every raw vote row for every list request.
- **`start_point` spatial index** — confirm that a `GIST` index exists on `routes.start_point` in Supabase (required for `ST_DWithin` to be fast at scale).
- **Cached / stored preview polyline** — compute and persist `preview_polyline` at route-creation time (e.g. a new `preview_polyline text` column on `routes`), so the list endpoint reads a pre-built string rather than fetching and encoding points on every request.

### Reliability & developer experience

- **~~Shared `calculateDistance` utility~~** ✓ Done — the Haversine function has been extracted to `src/utils/geo.js` alongside `encodePolyline` and `samplePoints`. The `POST /api/v1/routes` handler now imports it from there.
- **Centralised error handler** — an Express `(err, req, res, next)` middleware would remove the repeated `try/catch` + `res.status(500)` blocks across every handler.
- **`zod` schema validation** — define request schemas once (e.g. `CreateRouteSchema`) and validate at the boundary; eliminates scattered `if (!field)` guards and standardises `400` shapes automatically.
- **Transaction safety for route creation** — if `insert_route_points` fails after `create_route_with_geography` succeeds, the orphaned route row is never cleaned up. Wrap both RPC calls in a Postgres transaction (or add a cleanup/compensation step).
- **`.env.example`** — add a checked-in template so new contributors know which variables are required without reading the docs.
- **Integration test suite** — the `test/` directory is excluded from linting but has no tests. A lightweight suite (e.g. `supertest` + `vitest`) that spins up the Express app against a test Supabase project would catch regressions in route handlers before merge.
- **Polyline precision tuning** — `samplePoints` currently targets 20 points regardless of route length. A smarter strategy could vary the target based on `distance_meters` (e.g. ~1 point per 50 m, capped at 50) to give longer routes a higher-fidelity preview without bloating short-route payloads.
