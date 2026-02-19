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

#### 2. `GET /api/v1/routes/:id`

Return the full route object including all GPS points.

Suggested query:
```javascript
supabase
  .from('routes')
  .select(`*, route_points(*), route_tags(tags(name))`)
  .eq('id', req.params.id)
  .single();
```

#### 3. `POST /api/v1/routes/:id/vote`

Record an up/down vote with a context category (`safety`, `efficiency`, `scenery`) in the `votes` table.

Consider:
- One vote per user per route (upsert or unique constraint).
- Returning updated vote totals in the response.

#### 4. `POST /api/v1/routes/:id/comments`

Insert a row in a `comments` table (not yet created in the schema).

#### 5. `POST /api/v1/users/friends/request`

Insert a row in the `friends` table with `status = 'pending'`.

Also consider endpoints to accept/reject requests and list friends.

### Medium priority

#### 6. Location-based filtering in `GET /api/v1/routes`

The `lat`, `lng`, `radius`, `dest_lat`, and `dest_lng` query parameters are accepted today but not used. Once auth is in place, add a Supabase RPC function that filters routes using PostGIS `ST_DWithin` on `start_location`.

#### 7. `preview_polyline`

The `GET /api/v1/routes` response includes a `preview_polyline` field that is always `null`. This should be a simplified encoded polyline (e.g. Google Encoded Polyline format) derived from a subset of the route's `route_points`.

#### 8. Input validation middleware

Replace per-handler validation with a shared validation layer (e.g. `express-validator` or `zod`) to reduce boilerplate and standardise `400` error shapes.

### Lower priority / nice-to-have

- Pagination for `GET /api/v1/routes` (currently hard-capped at 100).
- `GET /api/v1/routes/:id/comments` — list comments on a route.
- Rate limiting (e.g. `express-rate-limit`) to protect public endpoints.
- Centralised error handler middleware to remove repeated `try/catch` blocks.
- `.env.example` file checked into the repo so contributors know which variables are needed.
