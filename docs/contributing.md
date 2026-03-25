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
   - Route data → `src/routes/routes/` (composed in `index.js`; add handlers in the focused module — e.g. `list.js`, `feed.js`, `detail.js`)
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

### Completed ✓

| Item | Notes |
|---|---|
| JWT authentication middleware | `requireAuth` in `src/middleware/auth.js`; applied to all write endpoints and `/users/*` |
| `GET /api/v1/routes/:id` | Full route detail with GPS points, tags, and vote stats |
| `POST /api/v1/routes/:id/vote` | Up/down vote with context category; upsert semantics |
| `POST /api/v1/routes/:id/comments` | Comment insertion with route-active guard |
| Location-based filtering in `GET /api/v1/routes` | `get_routes_near` RPC via PostGIS `ST_DWithin` on `start_point` |
| `preview_polyline` in `GET /api/v1/routes` | Google Encoded Polyline from up to 20 sampled GPS points; parallel RPC calls |
| Zod input validation | `validateBody` / `validateQuery` factories; per-domain schemas in `src/schemas/` |
| Parallel DB calls in `GET /api/v1/routes` | Votes + point fetches run in a single `Promise.all` |
| Parallel DB calls in `GET /api/v1/routes/:id` | Votes + `get_route_points_with_coords` run concurrently |
| Shared `calculateDistance` utility | Haversine formula extracted to `src/utils/geo.js` alongside `encodePolyline` / `samplePoints` |
| F1 — `GET /api/v1/routes/search` | `get_routes_between` RPC; ranked results + proximity fallback; `SearchRoutesQuerySchema` |
| F2 — Live campus events | `campus_events` table; `POST` / `GET` / `DELETE /api/v1/events`; `create_event_with_geography`, `get_events_near`, `list_active_events` RPCs |

---

### Planned — scoped and ready to implement

The following features are fully designed. Implement them in order; each is independent unless noted.

#### F3. Route notes (creator-private)

Route creators can attach a personal `notes` field to their own routes after creation. Notes are separate from the public `description` and never exposed to other users.

**Schema change:** Add `notes text` (nullable) to `routes`.

**New endpoint:** `PATCH /api/v1/routes/:id` (requireAuth)
- Accepts a partial body: any of `{ title, description, notes }`.
- Returns `403 Forbidden` when `routes.creator_id ≠ req.user.id`.
- Returns the updated route fields on success.

**Read visibility:** `GET /api/v1/routes/:id` includes `notes` only when the authenticated requester is the creator. All other callers receive `notes: null`.

**New schema:** `UpdateRouteSchema` — Zod `.partial()` on `{ title, description, notes }` with a `.refine()` requiring at least one field.

**Files to create/modify:**
- `PATCH /:id` handler under `src/routes/routes/` (e.g. `detail.js` or a new `update.js`).
- `UpdateRouteSchema` in `src/schemas/routes.js`.
- `GET /api/v1/routes/:id` handler — conditional `notes` field.
- `docs/api-reference.md` — `PATCH` endpoint + updated `GET /:id` response shape.
- `docs/database.md` — `notes` column in `routes` table.

---

#### F4. `GET /api/v1/routes/:id/comments`

The `comments` table is written to by `POST /api/v1/routes/:id/comments` but there is no read endpoint — the most glaring gap in the current API surface.

- Public endpoint; no auth required.
- Query params: `limit` (default 20, max 100), `cursor` (comment UUID for keyset pagination).
- Returns comments sorted by `created_at` ascending with author display name joined from `profiles`.
- Response includes a `next_cursor` field for the client to page forward.

**Files to create/modify:**
- New `GET /:id/comments` handler under `src/routes/routes/` (e.g. extend `comments.js`).
- `ListCommentsQuerySchema` in `src/schemas/routes.js`.
- `docs/api-reference.md` — new endpoint entry.

---

#### F5. `DELETE /api/v1/routes/:id`

Soft-delete a route (flip `is_active = false`). Restricted to the route's `creator_id`.

- Returns `403` when `creator_id ≠ req.user.id`.
- Returns `404` when the route does not exist or is already inactive.
- No schema change required.

**Files to create/modify:**
- New `DELETE /:id` handler under `src/routes/routes/` (e.g. extend `detail.js` or `create.js`).
- `docs/api-reference.md` — new endpoint entry.

---

### Backlog

Items below are not immediately scheduled but are well-understood enough to pick up independently.

#### API surface

- **`GET /api/v1/tags`** — expose the `tags` lookup table so clients can render a tag picker without hard-coding values. Read-only, public, cacheable. No schema change required.
- **`POST /api/v1/routes/:id/save` + `GET /api/v1/users/me/saved`** — let users bookmark routes. One `route_usage` insert on save; a filtered `SELECT` for the list. Mirrors how `stats.routes_saved` is already counted in `GET /api/v1/users/me`.
- **`GET /api/v1/users/:id/routes`** — public profile listing filtered by `creator_id`, respecting `is_active`. No schema change required.
- **Event confirmations** — allow other users to upvote a `campus_event` (a lightweight `event_confirmations` join table). High confirmation count could extend `expires_at` or boost map-overlay prominence.
- **Pagination for `GET /api/v1/routes`** — currently hard-capped at 100 rows with no cursor. Add `limit` / `offset` or keyset pagination consistent with the feed endpoint.

#### Performance

- **`GIST` indexes on `routes.start_point`, `routes.end_point`, and `campus_events.location`** — `ST_DWithin` is a full table scan without them. Verify in the Supabase dashboard and create if missing. `end_point` and `campus_events.location` are new requirements from F1 and F2 respectively; treat these as **blockers** before those features go to production.
- **`get_route_points_bulk` RPC** — a single Postgres function accepting an array of route UUIDs that returns all their decoded points in one round-trip, replacing the N parallel `get_route_points_with_coords` calls made for `preview_polyline`. High impact when the list returns many routes.
- **Cached `preview_polyline` column** — compute and store the encoded polyline at route-creation time (new `preview_polyline text` column on `routes`), so the list endpoint reads a pre-built string rather than fetching and re-encoding on every request.
- **Database-level vote aggregation** — move `avg_rating` / `upvotes` / `downvotes` into a Postgres view or materialized view so the Express layer stops pulling every raw vote row on every list request.
- **Response compression** — `compression` middleware gzips JSON responses; polyline strings and point arrays compress 70–80%.
- **Polyline precision tuning** — `samplePoints` targets 20 points regardless of distance. Vary the target by `distance_meters` (e.g. ~1 point per 50 m, capped at 50) for better fidelity on longer routes.

#### Reliability

- **Transaction safety for route creation** — if `insert_route_points` fails after `create_route_with_geography` succeeds, an orphaned `routes` row is left behind. Wrap both RPC calls in a Postgres transaction or add a compensating cleanup step.
- **Centralised error handler** — an Express `(err, req, res, next)` middleware removes the repeated `try/catch` + `res.status(500)` blocks across every handler and provides a single place to strip `details` fields in production.
- **Path-param UUID validation** — a `validateUuidParam(paramName)` middleware helper that returns `400` immediately when `:id` is not a valid UUID, preventing a cryptic 500 from Supabase on malformed IDs.
- **Zod `.strict()` on body schemas** — rejects unknown keys rather than silently ignoring them; prevents client bugs where extra fields go unnoticed during development.
- **Integration test suite** — `supertest` + `vitest` against a dedicated test Supabase project. The `test/` directory exists but is empty.
- **`.env.example`** — a checked-in template listing all required environment variables; unblocks new contributors without requiring them to read the full docs.

#### Security

- **`helmet`** — one-line middleware addition that sets `X-Content-Type-Options`, `HSTS`, `CSP`, and other secure HTTP headers.
- **Rate limiting** — `express-rate-limit` on `POST /auth/verify-school-email` (easiest endpoint to hammer), event creation (spam prevention), and vote/comment write endpoints.
- **Request size cap** — `express.json({ limit: '128kb' })` guards against large-payload DoS. GPS point arrays for long tracks can be large; tune the cap to a safe maximum.
- **CORS allow-list** — replace `cors({ origin: '*' })` with an `ALLOWED_ORIGINS` env var before any public release.
- **Event spam prevention** — enforce a per-user cooldown (e.g. one event filing per 5 minutes) at the application layer to prevent `campus_events` flooding. Can be implemented alongside rate limiting without a schema change.

#### Observability

- **Structured request logging** — `morgan` with JSON output gives per-request `method`, `path`, `status`, `duration_ms` that are greppable in production; more useful than ad-hoc `console.error` calls.
- **Request ID** — attach a `requestId` (`crypto.randomUUID()`) to every request via middleware and include it in error responses, enabling frontend teams to correlate a user-reported error to a log line.

#### Developer experience

- **Schema-driven Swagger `requestBody`** — replace hand-written JSDoc `schema:` blocks with references to generated OpenAPI components so docs and Zod validation always agree.
- **`openapi-zod-client` codegen** — derive TypeScript client types from the Zod schemas at build time, eliminating manual duplication between the backend contract and any typed frontend/mobile clients.

---

### Deferred / on hold

#### `POST /api/v1/users/friends/request`

On hold while the team finalises social graph semantics (unidirectional follow vs. mutual friendship, blocking, privacy). The stub endpoint and `friends` table exist; no logic is implemented. Revisit once the product design is settled.
