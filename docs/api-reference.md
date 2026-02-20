# API Reference

All endpoints are prefixed with `/api/v1/`. The server also exposes an interactive Swagger UI at `/api-docs` (auto-generated from JSDoc comments in the route files).

**Base URL (local):** `http://localhost:3000`

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
| `POST /api/v1/routes` | **Yes** |
| `GET /api/v1/routes/:id` | No |
| `POST /api/v1/routes/:id/vote` | **Yes** |
| `POST /api/v1/routes/:id/comments` | **Yes** |

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

**Response `400` — missing or malformed**
```json
{
  "allowed": false,
  "message": "Email is required"
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

> **Status: placeholder** — returns an empty `201` response. Not yet implemented.

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

**Response `400`** — missing required fields
```json
{
  "error": "Missing required fields",
  "required": ["title", "start_label", "end_label", "start_time", "end_time", "points"]
}
```

---

### `GET /api/v1/routes`

Search and list active routes. Supports tag filtering and multiple sort orders.

> **Location filtering is not yet active.** The `lat`, `lng`, `radius`, `dest_lat`, and `dest_lng` parameters are accepted and echoed back in the response, but are not currently used to filter results. Up to 100 routes are returned.

**Query parameters**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `lat` | float | — | User's current latitude *(not yet used for filtering)* |
| `lng` | float | — | User's current longitude *(not yet used for filtering)* |
| `radius` | integer | `500` | Search radius in meters *(not yet used for filtering)* |
| `dest_lat` | float | — | Destination latitude *(not yet used for filtering)* |
| `dest_lng` | float | — | Destination longitude *(not yet used for filtering)* |
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
      "preview_polyline": null,
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

**`avg_rating` calculation:** `(upvotes − downvotes) / total_votes`, rounded to 2 decimal places. Returns `0` when there are no votes.

---

### `GET /api/v1/routes/:id`

Get the full details of a single route including all GPS points and tags.

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

### `POST /api/v1/routes/:id/vote`

Cast an upvote or downvote on a route with a context category.

> **Status: placeholder** — returns an empty `201` response. Not yet implemented.

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

**Response `201`** *(placeholder)*
```json
{}
```

---

### `POST /api/v1/routes/:id/comments`

Add a comment to a route.

> **Status: placeholder** — returns an empty `201` response. Not yet implemented.

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
| `content` | string | Yes | Comment text |

**Response `201`** *(placeholder)*
```json
{}
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
