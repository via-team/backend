# API Reference

All endpoints are prefixed with `/api/v1/`. The server also exposes an interactive Swagger UI at `/api-docs` (auto-generated from JSDoc comments in the route files).

**Base URLs:**
- **Production:** `https://via-backend-2j3d.onrender.com`
- **Local:** `http://localhost:3000`

## Authentication

Protected endpoints require a valid Supabase JWT in the `Authorization` header:

```
Authorization: Bearer <supabase_access_token>
```

The token is validated by the `requireAuth` middleware (`src/middleware/auth.js`), which calls `supabase.auth.getUser(token)` and attaches the result to `req.user`. Public endpoints do not require a token.

| Endpoint | Auth required |
|---|---|
| `POST /api/v1/auth/verify-school-email` | No |
| `GET /api/v1/users/me` | **Yes** |
| `POST /api/v1/users/friends/request` | **Yes** |
| `GET /api/v1/routes` | No |
| `GET /api/v1/routes/search` | No |
| `GET /api/v1/routes/feed` | **Yes** only when `tab=friends`; `tab=top` and `tab=new` are public |
| `POST /api/v1/routes` | **Yes** |
| `GET /api/v1/routes/:id` | No |
| `PATCH /api/v1/routes/:id` | **Yes** |
| `POST /api/v1/routes/:id/vote` | **Yes** |
| `POST /api/v1/routes/:id/comments` | **Yes** |
| `GET /api/v1/events` | No |
| `POST /api/v1/events` | **Yes** |
| `DELETE /api/v1/events/:id` | **Yes** |

---

## System

### `GET /`

Root health probe.

**Response `200`**
```json
{ "message": "VIA API" }
```

---

### `GET /health`

Lightweight liveness check.

**Response `200`**
```json
{ "status": "ok" }
```

---

## Auth — `/api/v1/auth`

### `POST /api/v1/auth/verify-school-email`

Validates that an email address belongs to an allowed school domain before a user signs up. This is a pre-registration check only — it does **not** create an account.

**Allowed domains:** `@utexas.edu`, `@eid.utexas.edu`, `@my.utexas.edu`

**Request body**
```json
{
  "email": "student@utexas.edu"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `email` | string | Yes | Email address to validate |

**Response `200` — allowed**
```json
{
  "allowed": true,
  "message": "Email verified successfully"
}
```

**Response `200` — not allowed**
```json
{
  "allowed": false,
  "message": "Email domain not allowed. Please use a valid school email address."
}
```

**Response `400` — missing or malformed** (Zod validation error shape)
```json
{
  "error": "Validation error",
  "issues": [{ "field": "email", "message": "Invalid email format" }]
}
```

---

## Users — `/api/v1/users`

### `GET /api/v1/users/me`

Returns the authenticated user's profile and activity statistics.

**Required header**

```
Authorization: Bearer <supabase_access_token>
```

**Response `200`**
```json
{
  "id": "a1b2c3d4-...",
  "email": "student@utexas.edu",
  "display_name": "Alex Student",
  "created_at": "2024-09-01T12:00:00Z",
  "stats": {
    "routes_created": 5,
    "routes_saved": 12,
    "friends_count": 8
  }
}
```

**Response `401`** — missing or malformed `Authorization` header
```json
{
  "error": "Authentication required",
  "message": "Missing or malformed Authorization header. Expected: Bearer <token>"
}
```

**Response `401`** — expired or invalid token
```json
{
  "error": "Invalid token",
  "message": "The provided token is invalid or has expired."
}
```

**Response `404`** — user not found
```json
{
  "error": "User not found",
  "message": "Could not find user profile"
}
```

---

### `POST /api/v1/users/friends/request`

Send a friend request to another user.

> **Status: deferred** — returns an empty `201` response. Implementation is on hold while the team finalises the friend/social relationship semantics.

**Required header**

```
Authorization: Bearer <supabase_access_token>
```

**Request body**
```json
{
  "friend_id": "123e4567-e89b-12d3-a456-426614174000"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `friend_id` | UUID | Yes | UUID of the user to befriend |

**Response `201`** *(placeholder)*
```json
{}
```

---

## Routes — `/api/v1/routes`

### `POST /api/v1/routes`

Create a new walking/biking route by submitting recorded GPS points. The server calculates duration and total distance automatically.

**Required header**

```
Authorization: Bearer <supabase_access_token>
```

The authenticated user is recorded as the route's `creator_id`.

**Request body**
```json
{
  "title": "Quickest way to GDC from Jester",
  "description": "Avoids the Speedway crowd.",
  "start_label": "Jester West",
  "end_label": "GDC 2.216",
  "start_time": "2023-10-27T10:00:00Z",
  "end_time": "2023-10-27T10:15:00Z",
  "tags": ["uuid-of-tag-1", "uuid-of-tag-2"],
  "points": [
    { "seq": 1, "lat": 30.2849, "lng": -97.7341, "acc": 3.5, "time": "2023-10-27T10:00:00Z" },
    { "seq": 2, "lat": 30.2855, "lng": -97.7335, "acc": 4.0, "time": "2023-10-27T10:01:00Z" }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | string | Yes | Short display name for the route |
| `description` | string | No | Longer optional description |
| `start_label` | string | Yes | Human-readable start location name |
| `end_label` | string | Yes | Human-readable end location name |
| `start_time` | ISO 8601 datetime | Yes | When the route recording started |
| `end_time` | ISO 8601 datetime | Yes | When the route recording ended |
| `tags` | UUID[] | No | Array of tag UUIDs from the `tags` table |
| `points` | object[] | Yes (≥1) | Array of GPS point objects (see below) |

**GPS point object**

| Field | Type | Required | Description |
|---|---|---|---|
| `seq` | integer | Yes | Sequence number (used to order points) |
| `lat` | float | Yes | Latitude |
| `lng` | float | Yes | Longitude |
| `acc` | float | No | GPS accuracy in meters |
| `time` | ISO 8601 datetime | Yes | Timestamp of the point |

**How the server processes points:**
1. Points are sorted by `seq`.
2. Duration is calculated from `start_time` and `end_time`.
3. Total distance is computed with the **Haversine formula** over consecutive points.
4. The route row is inserted via the `create_route_with_geography` RPC function (handles PostGIS types).
5. All GPS points are inserted via the `insert_route_points` RPC function.
6. Tag associations are inserted into `route_tags`.

**Response `201`**
```json
{
  "route_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479"
}
```

**Response `400`** — missing or invalid fields (Zod validation error shape)
```json
{
  "error": "Validation error",
  "issues": [
    { "field": "title", "message": "title is required" },
    { "field": "points", "message": "points must contain at least one GPS point" }
  ]
}
```

---

### `GET /api/v1/routes`

Search and list active routes. Supports location-based filtering, tag filtering, and multiple sort orders. Up to 100 routes are returned.

**Location filtering:** When both `lat` and `lng` are supplied, the server calls the `get_routes_near` PostGIS RPC (`ST_DWithin` on `start_point`) and restricts results to routes whose start point falls within `radius` metres of the given coordinate. An empty `data` array is returned when no routes match.

> **Destination filtering** (`dest_lat`, `dest_lng`) is **deprecated** — use `GET /api/v1/routes/search` instead. The parameters are still accepted but have no effect.

**Query parameters**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `lat` | float | — | User's current latitude — activates location filtering when combined with `lng` |
| `lng` | float | — | User's current longitude — activates location filtering when combined with `lat` |
| `radius` | integer | `500` | Search radius in metres (applied when `lat` + `lng` are provided) |
| `dest_lat` | float | — | **Deprecated** — use `GET /api/v1/routes/search`. Accepted but unused. |
| `dest_lng` | float | — | **Deprecated** — use `GET /api/v1/routes/search`. Accepted but unused. |
| `tags` | string | — | Comma-separated tag **names** to filter by (e.g., `shade,quiet`) |
| `sort` | string | `recent` | Sort order: `recent`, `popular`, or `efficient` |

**Sort options**

| Value | Behavior |
|---|---|
| `recent` | Newest routes first (`created_at` descending) |
| `popular` | Most total votes first |
| `efficient` | Shortest distance first (`distance_meters` ascending) |

**Response `200`**
```json
{
  "data": [
    {
      "id": "f47ac10b-...",
      "title": "Quickest way to GDC from Jester",
      "start_label": "Jester West",
      "end_label": "GDC 2.216",
      "distance_meters": 820,
      "avg_rating": 0.75,
      "tags": ["shade", "quiet"],
      "preview_polyline": "ypzpDfkrpNqAzB...",
      "created_at": "2023-10-27T10:15:00Z"
    }
  ],
  "count": 1,
  "filters": {
    "lat": null,
    "lng": null,
    "radius": 500,
    "tags": "shade,quiet",
    "sort": "popular"
  }
}
```

**`preview_polyline` details:** A [Google Encoded Polyline](https://developers.google.com/maps/documentation/utilities/polylinealgorithm) string derived from the route's GPS points. Up to 20 evenly-sampled points are encoded (first and last points are always preserved). The field is `null` when the route has no stored points.

**Response `400`** — invalid query parameters (Zod validation error shape)
```json
{
  "error": "Validation error",
  "issues": [{ "field": "lat", "message": "Number must be greater than or equal to -90" }]
}
```

**`avg_rating` calculation:** `(upvotes − downvotes) / total_votes`, rounded to 2 decimal places. Returns `0` when there are no votes.

---

### `GET /api/v1/routes/search`

Search for routes that connect a specific origin to a specific destination. The server uses PostGIS `ST_DWithin` on both `start_point` and `end_point` to find full matches, then ranks them by `duration_seconds` ascending. When no route satisfies both proximity constraints, routes near the origin are returned as a fallback.

**Query parameters**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `from_lat` | float | **required** | Origin latitude |
| `from_lng` | float | **required** | Origin longitude |
| `to_lat` | float | **required** | Destination latitude |
| `to_lng` | float | **required** | Destination longitude |
| `from_radius` | integer | `300` | Metres from origin to match a route's `start_point` |
| `to_radius` | integer | `300` | Metres from destination to match a route's `end_point` |

**Logic:**
1. Calls the `get_routes_between` RPC — `ST_DWithin` on both `start_point` and `end_point`.
2. Sorts matching routes by `duration_seconds` ascending (shortest trip first) and returns them in `data` with `matched: true`.
3. If no matches: falls back to `get_routes_near` on the origin and returns those results in `data` with `matched: false`.

**Response `200` — full match found (`matched: true`)**
```json
{
  "data": [
    {
      "id": "f47ac10b-...",
      "title": "Quickest way to GDC from Jester",
      "start_label": "Jester West",
      "end_label": "GDC 2.216",
      "distance_meters": 820,
      "avg_rating": 0.75,
      "tags": ["shade", "quiet"],
      "preview_polyline": "ypzpDfkrpNqAzB...",
      "created_at": "2023-10-27T10:15:00Z"
    }
  ],
  "count": 1,
  "search": {
    "from_lat": 30.284,
    "from_lng": -97.734,
    "to_lat": 30.286,
    "to_lng": -97.731,
    "from_radius": 300,
    "to_radius": 300,
    "matched": true
  }
}
```

**Response `200` — no full match (`matched: false`)**
```json
{
  "data": [{ "id": "...", "title": "..." }],
  "count": 1,
  "search": {
    "from_lat": 30.284,
    "from_lng": -97.734,
    "to_lat": 30.286,
    "to_lng": -97.731,
    "from_radius": 300,
    "to_radius": 300,
    "matched": false
  }
}
```

When `matched: true`, `data` is sorted by `duration_seconds` ascending (shortest trip first). When `matched: false`, `data` contains routes near the origin only. Route objects share the same shape as the items returned by `GET /api/v1/routes`.

**Response `400`** — missing or invalid query parameters (Zod validation error shape)
```json
{
  "error": "Validation error",
  "issues": [{ "field": "from_lat", "message": "from_lat is required" }]
}
```

**Response `500`** — database error

---

### `GET /api/v1/routes/feed`

Home feed for **Top**, **Friends**, and **New** tabs. Each route object matches the list shape from `GET /api/v1/routes` (`id`, `creator`, `title`, labels, `distance_meters`, `avg_rating`, `tags`, `preview_polyline`, `created_at`), except the **Top** tab also includes **`feed_score`** (see below).

**Authentication:** Required only when `tab=friends` (`Authorization: Bearer <token>`). Missing or invalid tokens return `401` with the same shape as other protected routes.

**Query parameters**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `tab` | string | — | **Required.** `top`, `friends`, or `new` |
| `limit` | integer | `20` | Page size (max `100`) |
| `offset` | integer | `0` | Number of rows to skip (offset pagination) |
| `lat` | float | — | When set with `lng`, restricts to routes whose start point is within `radius` m (same RPC as `GET /api/v1/routes`) |
| `lng` | float | — | See `lat` |
| `radius` | integer | `500` | Search radius in metres when `lat` + `lng` are provided |

**Tab behavior**

| `tab` | Ordering / selection |
|---|---|
| `top` | Loads up to **500** most recently created active routes (after any location filter), computes a **hot score** from upvotes and age, sorts descending, then applies `offset` / `limit`. |
| `new` | Newest routes first (`created_at` descending), with database-level `offset` / `limit`. |
| `friends` | Routes whose `creator_id` is an **accepted** friend (either side of `friends`); merged and sorted by `created_at` descending, then `offset` / `limit` in memory. Large friend lists are queried in chunks of 100 creator IDs. |

**Top tab hot score**

The server ranks `top` using:

```text
feed_score = (1 + upvotes) / ((age_hours + 2) ^ 1.5)
```

where `upvotes` is the count of `votes` rows with `vote_type = 'up'` for that route, and `age_hours` is the non-negative number of hours since `routes.created_at`. Responses expose this as **`feed_score`** (rounded to 6 decimal places). Ties are broken by newer `created_at` first.

**Pagination note:** For `tab=top`, ordering is by score over a capped candidate set; if underlying vote counts or ages change between requests, offset pagination can shift slightly. Prefer smaller pages or refetch from `offset=0` when refreshing the Top feed.

**Response `200`**
```json
{
  "data": [
    {
      "id": "f47ac10b-...",
      "creator_id": "...",
      "creator": { "id": "...", "full_name": "Alex", "email": "..." },
      "title": "Quickest way to GDC from Jester",
      "start_label": "Jester West",
      "end_label": "GDC 2.216",
      "distance_meters": 820,
      "avg_rating": 0.75,
      "tags": ["shade"],
      "preview_polyline": "ypzpDfkrpNqAzB...",
      "created_at": "2023-10-27T10:15:00Z",
      "feed_score": 0.142857
    }
  ],
  "count": 1,
  "filters": {
    "tab": "top",
    "limit": 20,
    "offset": 0,
    "lat": null,
    "lng": null,
    "radius": 500,
    "total": 42
  }
}
```

`filters.total` is the number of routes matching the tab **before** applying the current page slice (for `new`, this is the full matching count from the database; for `top`, the number of scored candidates, at most 500 before location filter). `count` is the number of items in `data` for this response.

The `feed_score` field is present only when `tab=top`.

**Response `401`** — `tab=friends` without a valid Bearer token.

**Response `400`** — invalid query (e.g. missing `tab`, bad `limit`).

---

### `GET /api/v1/routes/:id`

Get the full details of a single route including all GPS points and tags.

This endpoint is public. If the route creator includes a valid Bearer token, the response also includes their private `notes`; all other callers receive `notes: null`.

**Path parameter**

| Parameter | Type | Description |
|---|---|---|
| `id` | UUID | Route UUID |

**Response `200`**
```json
{
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "title": "Quickest way to GDC from Jester",
  "description": "Avoids the Speedway crowd.",
  "notes": null,
  "start_label": "Jester West",
  "end_label": "GDC 2.216",
  "distance_meters": 820,
  "duration_seconds": 900,
  "start_time": "2023-10-27T10:00:00Z",
  "end_time": "2023-10-27T10:15:00Z",
  "avg_rating": 0.75,
  "vote_count": 4,
  "tags": ["shade", "quiet"],
  "route_points": [
    { "seq": 1, "lat": 30.2849, "lng": -97.7341, "accuracy_meters": 3.5, "recorded_at": "2023-10-27T10:00:00Z" },
    { "seq": 2, "lat": 30.2855, "lng": -97.7335, "accuracy_meters": 4.0, "recorded_at": "2023-10-27T10:01:00Z" }
  ],
  "created_at": "2023-10-27T10:15:00Z"
}
```

`route_points` are sorted by `seq` (ascending). `avg_rating` uses the same calculation as `GET /api/v1/routes`: `(upvotes − downvotes) / total_votes`, rounded to 2 decimal places.

**Response `404`** — route not found or inactive
```json
{
  "error": "Route not found",
  "message": "No active route found with id f47ac10b-58cc-4372-a567-0e02b2c3d479"
}
```

**Response `500`** — database error
```json
{
  "error": "Failed to fetch route",
  "message": "..."
}
```

---

### `PATCH /api/v1/routes/:id`

Update the editable fields on a route you created. At least one of `title`, `description`, or `notes` must be provided.

`notes` are creator-private and are never exposed to other users. Sending an empty string for `description` or `notes` clears the field and stores `null`.

**Required header**

```
Authorization: Bearer <supabase_access_token>
```

**Path parameter**

| Parameter | Type | Description |
|---|---|---|
| `id` | UUID | Route UUID |

**Request body**
```json
{
  "title": "Quieter walk to GDC",
  "description": "Cuts behind the library and avoids Speedway.",
  "notes": "Best before 9am. East entrance is usually unlocked."
}
```

All fields are optional, but the request body must include at least one of them.

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | string | No | Public route title; must not be empty when provided |
| `description` | string | No | Public route description |
| `notes` | string | No | Private creator-only notes |

**Response `200`**
```json
{
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "title": "Quieter walk to GDC",
  "description": "Cuts behind the library and avoids Speedway.",
  "notes": "Best before 9am. East entrance is usually unlocked."
}
```

**Response `400`** — invalid or empty body (Zod validation error shape)
```json
{
  "error": "Validation error",
  "issues": [{ "field": "(root)", "message": "At least one field must be provided" }]
}
```

**Response `401`** — missing or malformed `Authorization` header, or invalid token

**Response `403`** — authenticated user is not the route creator
```json
{
  "error": "Forbidden",
  "message": "You can only update routes you created"
}
```

**Response `404`** — route not found or inactive
```json
{
  "error": "Route not found",
  "message": "No active route found with id f47ac10b-58cc-4372-a567-0e02b2c3d479"
}
```

---

### `POST /api/v1/routes/:id/vote`

Cast an upvote or downvote on a route with a context category. One vote per user per route — re-voting replaces the previous vote (upsert).

**Required header**

```
Authorization: Bearer <supabase_access_token>
```

**Path parameter**

| Parameter | Type | Description |
|---|---|---|
| `id` | UUID | Route UUID |

**Request body**
```json
{
  "vote_type": "up",
  "context": "safety"
}
```

| Field | Type | Required | Values |
|---|---|---|---|
| `vote_type` | string | Yes | `up`, `down` |
| `context` | string | Yes | `safety`, `efficiency`, `scenery` |

**Response `201`**
```json
{
  "message": "Vote recorded successfully",
  "route_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "vote_type": "up",
  "context": "safety",
  "vote_count": 5,
  "upvotes": 4,
  "downvotes": 1,
  "avg_rating": 0.60
}
```

**Response `400`** — missing or invalid fields (Zod validation error shape)
```json
{
  "error": "Validation error",
  "issues": [{ "field": "vote_type", "message": "vote_type must be 'up' or 'down'" }]
}
```

**Response `404`** — route not found or inactive
```json
{
  "error": "Route not found",
  "message": "No active route found with id f47ac10b-58cc-4372-a567-0e02b2c3d479"
}
```

**Response `500`** — database error
```json
{
  "error": "Failed to record vote",
  "message": "..."
}
```

---

### `POST /api/v1/routes/:id/comments`

Add a comment to a route.

**Required header**

```
Authorization: Bearer <supabase_access_token>
```

**Path parameter**

| Parameter | Type | Description |
|---|---|---|
| `id` | UUID | Route UUID |

**Request body**
```json
{
  "content": "Super cool route Nolan!"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `content` | string | Yes | Comment text (must not be empty) |

**Response `201`**
```json
{
  "message": "Comment added successfully",
  "comment_id": "a1b2c3d4-...",
  "route_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "user_id": "e5f6a7b8-...",
  "content": "Super cool route Nolan!",
  "created_at": "2024-09-01T12:00:00Z"
}
```

**Response `400`** — missing or empty content (Zod validation error shape)
```json
{
  "error": "Validation error",
  "issues": [{ "field": "content", "message": "content must not be empty" }]
}
```

**Response `404`** — route not found or inactive
```json
{
  "error": "Route not found",
  "message": "No active route found with id f47ac10b-58cc-4372-a567-0e02b2c3d479"
}
```

**Response `500`** — database error
```json
{
  "error": "Failed to add comment",
  "message": "..."
}
```

---

## Events — `/api/v1/events`

### `POST /api/v1/events`

Files a new time-bounded campus event at a given location. The server computes `expires_at` as `NOW() + duration_minutes * 1 minute`.

**Required header**

```
Authorization: Bearer <supabase_access_token>
```

**Request body**

```json
{
  "type": "crowd",
  "duration_minutes": 30,
  "lat": 30.2849,
  "lng": -97.7341,
  "description": "Big crowd near the union",
  "location_label": "West Mall",
  "route_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | string | Yes | One of `crime`, `crowd`, `line`, `construction`, `other` |
| `duration_minutes` | integer | Yes | Positive integer; controls how long the event is visible |
| `lat` | float | Yes | Latitude of the event location |
| `lng` | float | Yes | Longitude of the event location |
| `description` | string | No | Optional free-text detail |
| `location_label` | string | No | Human-readable location name |
| `route_id` | UUID | No | Route the user was navigating when they filed the event |

**Suggested client defaults for `duration_minutes`:** `crowd` / `line` → 30, `crime` → 60, `construction` → 240, `other` → 60.

**Response `201`**
```json
{
  "event_id": "a1b2c3d4-...",
  "message": "Event created successfully"
}
```

**Response `400`** — validation error
```json
{
  "error": "Validation error",
  "issues": [{ "field": "type", "message": "type is required" }]
}
```

**Response `401`** — missing or invalid token
```json
{
  "error": "Unauthorized",
  "message": "..."
}
```

---

### `GET /api/v1/events`

Returns all active, non-expired campus events. When `lat` and `lng` are supplied, results are filtered to within `radius` metres of that point.

**Query parameters**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `lat` | float | — | Latitude of the centre point (requires `lng`) |
| `lng` | float | — | Longitude of the centre point (requires `lat`) |
| `radius` | integer | `500` | Spatial filter radius in metres (only used when `lat`/`lng` are provided) |

**Response `200`**
```json
{
  "data": [
    {
      "id": "a1b2c3d4-...",
      "reporter_id": "b2c3d4e5-...",
      "type": "crowd",
      "description": "Big crowd near the union",
      "lat": 30.2849,
      "lng": -97.7341,
      "location_label": "West Mall",
      "route_id": null,
      "duration_minutes": 30,
      "expires_at": "2025-10-27T11:30:00Z",
      "is_active": true,
      "created_at": "2025-10-27T11:00:00Z"
    }
  ],
  "count": 1
}
```

**Response `400`** — `lat` supplied without `lng` or vice-versa

---

### `DELETE /api/v1/events/:id`

Soft-deletes an event by setting `is_active = false`. Only the original reporter may call this endpoint.

**Required header**

```
Authorization: Bearer <supabase_access_token>
```

**Response `200`**
```json
{ "message": "Event deactivated successfully" }
```

**Response `403`** — caller is not the reporter
```json
{
  "error": "Forbidden",
  "message": "You can only deactivate events you reported"
}
```

**Response `404`** — event not found or already inactive
```json
{
  "error": "Event not found",
  "message": "No event found with id a1b2c3d4-..."
}
```

---

## Error format

All error responses share a consistent shape:

```json
{
  "error": "Short machine-readable label",
  "message": "Human-readable explanation"
}
```

Some endpoints include a `details` field with the underlying database error message for debugging:

```json
{
  "error": "Failed to create route",
  "details": "insert or update on table \"routes\" violates foreign key constraint ..."
}
```

### Validation errors (`400`)

When a request body or query string fails Zod schema validation, the server returns:

```json
{
  "error": "Validation error",
  "issues": [
    { "field": "points", "message": "points must contain at least one GPS point" },
    { "field": "start_time", "message": "start_time must be a valid ISO 8601 datetime" }
  ]
}
```

Each entry in `issues` has:

| Field | Type | Description |
|---|---|---|
| `field` | string | Dot-path to the offending field (e.g. `points.0.lat`), or `(root)` for top-level type errors |
| `message` | string | Human-readable reason the field failed validation |

This shape is returned by every endpoint that uses the `validateBody` / `validateQuery` middleware — the legacy one-off `400` shapes documented per-endpoint below are superseded by this format for field-level errors. Non-validation `400` responses (e.g. business-logic rejections) continue to use the standard `{ error, message }` shape.
