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
- Database schema, RLS, and SQL function changes are managed directly in Supabase, not via checked-in repo migrations. After making a live DB change, update the relevant docs in `docs/`.

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
| F3 — Route notes (creator-private) | `PATCH /api/v1/routes/:id`; conditional `notes` visibility in `GET /api/v1/routes/:id`; `UpdateRouteSchema` |
| F4 — `GET /api/v1/routes/:id/comments` | Public paginated comment listing with `limit`, UUID `cursor`, `next_cursor`, and author display names |
| F5 — `DELETE /api/v1/routes/:id` | Creator-only soft delete that flips `is_active = false` |
| F6 — `GET /api/v1/tags` | Public list of `tags` (`id`, `name`, `category`) ordered by `name`; `src/routes/tags.js` |
| F7 — Mutual friendships | `POST /friends/request` (pending + reciprocal auto-accept), `POST /friends/:id/accept`, `GET /me/friends`, `DELETE /friends/:id`; helpers in `src/services/friends.js`; `FriendParamSchema` + `validateParams` middleware |

---

### Planned — scoped and ready to implement

The following features are fully designed enough to queue next. They are ordered from smallest/lowest-risk to broader product work, then by production-hardening priority.

#### F8. Pagination for `GET /api/v1/routes`

Add pagination to the main route listing endpoint so clients can browse past the current hard cap of 100 rows.

**Recommended shape:**
- Add query params `limit` (default `20`, max `100`) and `offset` for consistency with `GET /api/v1/routes/feed`.
- Apply pagination after tag/location filtering and the selected sort order.
- Include pagination fields in the `filters` object or return a `total` count so clients can render next/previous state cleanly.
- Preserve the existing route card response shape.

**Notes:**
- Offset pagination is the smallest change because `GET /api/v1/routes/feed` already uses it.
- Keyset pagination can be revisited later if list performance becomes an issue.

**Files to create/modify:**
- `src/schemas/routes.js` — extend `ListRoutesQuerySchema`.
- `src/routes/routes/list.js` — apply `limit` / `offset` and expose pagination metadata.
- `docs/api-reference.md` — query params and response examples.
- Tests for default paging, custom paging, and pagination combined with filters.

---

#### F9. Production hardening baseline

Harden the public API surface before broader release by tightening browser access, request limits, and abuse controls.

**Core behavior:**
- Replace `cors({ origin: '*' })` with an `ALLOWED_ORIGINS` env-driven allow-list.
- Add `helmet` middleware for baseline secure HTTP headers.
- Add an explicit `express.json({ limit: ... })` cap sized for realistic route uploads.
- Add rate limiting to `POST /api/v1/auth/verify-school-email`, event creation, and vote/comment write endpoints.

**Notes:**
- Tune limits with route GPS payload sizes in mind.
- If deployed behind Render or another reverse proxy, configure Express `trust proxy` correctly before relying on IP-based rate limiting.

**Files to create/modify:**
- `src/index.js` — middleware registration and any proxy trust configuration.
- `docs/architecture.md` — middleware/configuration notes.
- `docs/getting-started.md` and/or environment variable docs — `ALLOWED_ORIGINS` and any rate-limit config.
- `package.json` — add middleware dependencies.
- Tests for allowed/disallowed origins and representative throttled endpoints where practical.

---

#### F10. API reliability and observability baseline

Improve debuggability and reduce accidental 500s by standardising request tracing and server-side error handling.

**Core behavior:**
- Add a central Express error handler so routes can share one production-safe error response path.
- Add request IDs to every request and include them in logs and error responses.
- Add structured request logging with method, path, status, duration, and request ID.
- Add a reusable `validateUuidParam(paramName)` middleware so malformed `:id` params fail with `400` instead of bubbling into Supabase errors.

**Notes:**
- The central error handler is the right place to strip `details` fields in production.
- UUID validation should be rolled out to route, event, and any future user-id path params.

**Files to create/modify:**
- `src/index.js` — request-id middleware, logger registration, and central error handler wiring.
- `src/middleware/` — error-handler and UUID-param middleware helpers.
- Route files with `:id` params — adopt the UUID validator.
- `docs/api-reference.md` — document any new request-id error field or updated `400` behavior.
- `docs/architecture.md` — request lifecycle / middleware stack updates.

---

#### F11. Performance hardening

Reduce avoidable response cost in the current API before larger database optimisations.

**Core behavior:**
- Add `compression` middleware for JSON-heavy responses.
- Verify `GIST` indexes on `routes.start_point`, `routes.end_point`, and `campus_events.location` across all active Supabase environments.
- If any environment is missing them, create the indexes directly in Supabase and update docs to match.

**Follow-up candidate:** `get_route_points_bulk` RPC remains the next larger performance project after this baseline hardening work.

**Files to create/modify:**
- `src/index.js` — compression middleware registration.
- `docs/database.md` — index verification status if anything changes.
- `docs/contributing.md` — move `get_route_points_bulk` up once the baseline is complete.
- Environment/setup docs if index verification reveals missing infra steps.

---

#### F12. Contributor experience baseline

Reduce setup friction for new contributors with a checked-in environment template.

**Core behavior:**
- Add `.env.example` listing all required environment variables.
- Keep it aligned with `docs/getting-started.md` and `docs/architecture.md`.

**Files to create/modify:**
- `.env.example`
- `docs/getting-started.md`
- `docs/architecture.md`

---

### Backlog

Items below are not immediately scheduled but are well-understood enough to pick up independently.

#### API surface

- **`POST /api/v1/routes/:id/save` + `GET /api/v1/users/me/saved`** — let users bookmark routes. One `route_usage` insert on save; a filtered `SELECT` for the list. Mirrors how `stats.routes_saved` is already counted in `GET /api/v1/users/me`.
- **`GET /api/v1/users/:id/routes`** — public profile listing filtered by `creator_id`, respecting `is_active`. No schema change required.
- **Event confirmations** — allow other users to upvote a `campus_event` (a lightweight `event_confirmations` join table). High confirmation count could extend `expires_at` or boost map-overlay prominence.

#### Performance

- **`get_route_points_bulk` RPC** — a single Postgres function accepting an array of route UUIDs that returns all their decoded points in one round-trip, replacing the N parallel `get_route_points_with_coords` calls made for `preview_polyline`. High impact when the list returns many routes.
- **Cached `preview_polyline` column** — compute and store the encoded polyline at route-creation time (new `preview_polyline text` column on `routes`), so the list endpoint reads a pre-built string rather than fetching and re-encoding on every request.
- **Database-level vote aggregation** — move `avg_rating` / `upvotes` / `downvotes` into a Postgres view or materialized view so the Express layer stops pulling every raw vote row on every list request.
- **Polyline precision tuning** — `samplePoints` targets 20 points regardless of distance. Vary the target by `distance_meters` (e.g. ~1 point per 50 m, capped at 50) for better fidelity on longer routes.

#### Reliability

- **Transaction safety for route creation** — if `insert_route_points` fails after `create_route_with_geography` succeeds, an orphaned `routes` row is left behind. Wrap both RPC calls in a Postgres transaction or add a compensating cleanup step.
- **Zod `.strict()` on body schemas** — rejects unknown keys rather than silently ignoring them; prevents client bugs where extra fields go unnoticed during development.
- **Integration test suite** — `supertest` + `vitest` against a dedicated test Supabase project. The `test/` directory exists but is empty.

#### Security

- **Event spam prevention** — enforce a per-user cooldown (e.g. one event filing per 5 minutes) at the application layer to prevent `campus_events` flooding. Can be implemented alongside rate limiting without a schema change.

#### Observability

- **Request ID propagation to downstream services** — once request IDs exist, forward them into Supabase-facing logs and any future external integrations for end-to-end tracing.

#### Developer experience

- **Schema-driven Swagger `requestBody`** — replace hand-written JSDoc `schema:` blocks with references to generated OpenAPI components so docs and Zod validation always agree.
- **`openapi-zod-client` codegen** — derive TypeScript client types from the Zod schemas at build time, eliminating manual duplication between the backend contract and any typed frontend/mobile clients.

---

### Deferred / on hold

No items are currently deferred.
