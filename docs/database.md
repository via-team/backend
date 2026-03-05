# Database

VIA uses **Supabase** — a managed PostgreSQL service — as its data store. The PostGIS extension is enabled for geographic data (route paths and GPS points).

## Connection

The backend connects to Supabase using the `@supabase/supabase-js` client, configured in `src/config/supabase.js`:

```javascript
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
```

The **anon (public)** key is used, so all queries run under the permissions granted by Supabase's **Row Level Security (RLS)** policies. These policies are configured in the Supabase dashboard, not in this codebase.

## Schema

The schema below reflects the live Supabase database. The authoritative source of truth is the Supabase dashboard.

---

### `profiles`

Stores basic user profile information, typically populated on sign-up.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID (PK) | Matches the Supabase auth user ID |
| `email` | text | User's email address |
| `full_name` | text | Display name |
| `created_at` | timestamptz | Account creation timestamp |

---

### `routes`

Core table for user-created routes.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID (PK) | Auto-generated (`gen_random_uuid()`) |
| `creator_id` | UUID (FK → `profiles.id`) | Nullable |
| `title` | text | Short display name |
| `description` | text | Optional longer description |
| `start_label` | text | Human-readable start location name |
| `end_label` | text | Human-readable end location name |
| `start_point` | geography (PostGIS) | Start coordinates |
| `end_point` | geography (PostGIS) | End coordinates |
| `start_time` | timestamptz | When the route recording began |
| `end_time` | timestamptz | When the route recording ended |
| `duration_seconds` | integer | Calculated from `end_time − start_time` |
| `distance_meters` | float | Total path length via Haversine formula |
| `is_active` | boolean | Soft-delete flag; `false` = hidden from results (default `true`) |
| `created_at` | timestamptz | Row creation timestamp |

> PostGIS `geography` columns allow spatial queries (e.g. proximity search). These are written via the `create_route_with_geography` RPC function because the Supabase JS client does not natively construct PostGIS types.

---

### `route_points`

Individual GPS samples that make up a route's path.

| Column | Type | Notes |
|---|---|---|
| `id` | bigint (PK) | Auto-generated (sequence) |
| `route_id` | UUID (FK → `routes.id`) | Parent route |
| `sequence` | integer | Ordering index (sorted ascending for display) |
| `location` | geography (PostGIS) | Point geometry (stores lat/lng — no separate columns) |
| `recorded_at` | timestamptz | Timestamp of the GPS sample |
| `accuracy_meters` | float | GPS horizontal accuracy (nullable) |

Written via the `insert_route_points` RPC function. Latitude and longitude are stored only inside the `location` geography column; use the `get_route_points` RPC (which calls `ST_Y`/`ST_X`) to read them back as plain floats.

---

### `tags`

Lookup table for route tags (e.g. "shade", "quiet").

| Column | Type | Notes |
|---|---|---|
| `id` | UUID (PK) | Auto-generated (`gen_random_uuid()`) |
| `name` | text | Tag label (unique) |
| `category` | text | Optional grouping category (nullable) |

---

### `route_tags`

Many-to-many join between routes and tags.

| Column | Type | Notes |
|---|---|---|
| `route_id` | UUID (FK → `routes.id`) | |
| `tag_id` | UUID (FK → `tags.id`) | |

---

### `votes`

Up/down votes on routes, with a required context category.

| Column | Type | Notes |
|---|---|---|
| `user_id` | UUID (PK, FK → `profiles.id`) | Voter |
| `route_id` | UUID (PK, FK → `routes.id`) | |
| `context` | text | PK; `'safety'`, `'efficiency'`, or `'scenery'` |
| `vote_type` | text | `'up'` or `'down'` (DB constraint) |
| `created_at` | timestamptz | |

**Primary key:** composite `(user_id, route_id, context)` — one vote per user per route per context category.

**Rating formula used in `GET /api/v1/routes`:**
```
avg_rating = (upvotes − downvotes) / total_votes
```

---

### `comments`

User comments on routes.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID (PK) | Auto-generated (`gen_random_uuid()`) |
| `route_id` | UUID (FK → `routes.id`) | Commented-on route (nullable) |
| `user_id` | UUID (FK → `profiles.id`) | Comment author (nullable) |
| `content` | text | Comment text (nullable) |
| `created_at` | timestamptz | |

---

### `route_usage`

Tracks when a user navigates a route.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID (PK) | Auto-generated (`gen_random_uuid()`) |
| `route_id` | UUID (FK → `routes.id`) | |
| `user_id` | UUID (FK → `profiles.id`) | |
| `started_at` | timestamptz | When the user began navigating (nullable) |
| `completed_at` | timestamptz | When the user finished navigating (nullable) |
| `success` | boolean | Whether the navigation was completed successfully (nullable) |

Used in `GET /api/v1/users/me` to calculate `stats.routes_saved`.

---

### `friends`

Friend relationships between users.

| Column | Type | Notes |
|---|---|---|
| `requester_id` | UUID (PK, FK → `profiles.id`) | User who sent the request |
| `addressee_id` | UUID (PK, FK → `profiles.id`) | User who received the request |
| `status` | text | `'pending'` or `'accepted'` (DB constraint — `'rejected'` is **not** valid) |
| `created_at` | timestamptz | |

**Primary key:** composite `(requester_id, addressee_id)` — one relationship row per pair of users.

The `GET /api/v1/users/me` endpoint queries this table for rows where the user is either `requester_id` or `addressee_id` and `status = 'accepted'` to compute `stats.friends_count`.

---

## RPC functions

Three Supabase database functions are called via `supabase.rpc(...)`. They exist to work around the Supabase JS client's inability to construct or read PostGIS `geography` values directly.

### `create_route_with_geography`

Creates a single row in `routes` and populates the PostGIS `geography` columns.

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `p_creator_id` | UUID | Route creator (nullable) |
| `p_title` | text | Route title |
| `p_description` | text | Optional description |
| `p_start_label` | text | Start location name |
| `p_end_label` | text | End location name |
| `p_start_lng` | float | Longitude of the first GPS point |
| `p_start_lat` | float | Latitude of the first GPS point |
| `p_end_lng` | float | Longitude of the last GPS point |
| `p_end_lat` | float | Latitude of the last GPS point |
| `p_start_time` | timestamptz | Route start time |
| `p_end_time` | timestamptz | Route end time |
| `p_duration_seconds` | integer | Pre-calculated duration |
| `p_distance_meters` | float | Pre-calculated distance |

**Returns:** the new route's UUID.

---

### `get_route_points`

Returns all GPS points for a route with latitude and longitude extracted from the PostGIS `geography` column.

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `p_route_id` | UUID | Parent route |

**Returns:** table of `{ sequence, lat, lng, accuracy_meters, recorded_at }`, sorted by `sequence` ascending. Used by `GET /api/v1/routes/:id` since the JS client cannot read PostGIS geography values directly.

---

### `get_route_points_with_coords`

Functionally equivalent to `get_route_points` but returns columns named `lat` and `lng` (as opposed to extracting them inside a query). Used by both `GET /api/v1/routes/:id` and the `preview_polyline` computation in `GET /api/v1/routes`.

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `p_route_id` | UUID | Parent route |

**Returns:** table of `{ sequence, lat, lng, accuracy_meters, recorded_at }`, sorted by `sequence` ascending.

---

### `insert_route_points`

Bulk-inserts GPS point records with PostGIS geography types.

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `p_route_id` | UUID | Parent route |
| `p_points` | JSON array | Array of point objects |

Each element of `p_points`:

```json
{
  "sequence": 1,
  "lng": -97.7341,
  "lat": 30.2849,
  "recorded_at": "2023-10-27T10:00:00Z",
  "accuracy_meters": 3.5
}
```

---

### `get_routes_near`

Returns the IDs of active routes whose `start_point` falls within a given radius of a reference coordinate, using PostGIS `ST_DWithin`. Called by `GET /api/v1/routes` when `lat` and `lng` query parameters are provided.

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `p_lat` | double precision | Latitude of the centre point |
| `p_lng` | double precision | Longitude of the centre point |
| `p_radius_meters` | double precision | Search radius in metres (default `500`) |

**Returns:** table of `{ id uuid }` — one row per matching active route.

**SQL (run in the Supabase SQL editor to create or update):**

```sql
CREATE OR REPLACE FUNCTION get_routes_near(
  p_lat double precision,
  p_lng double precision,
  p_radius_meters double precision DEFAULT 500
)
RETURNS TABLE(id uuid)
LANGUAGE sql
STABLE
AS $$
  SELECT r.id
  FROM routes r
  WHERE r.is_active = true
    AND ST_DWithin(
      r.start_point,
      ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
      p_radius_meters
    );
$$;
```

> `ST_DWithin` operates on `geography` types and measures distance in metres, so no unit conversion is required.

---

## Distance calculation

The total route distance is calculated **in the Express layer** before any database writes, using the **Haversine formula** in `src/utils/geo.js` (`calculateDistance`). The `POST /api/v1/routes` handler imports and calls this shared utility.

```
a = sin²(Δlat/2) + cos(lat1) · cos(lat2) · sin²(Δlng/2)
c = 2 · atan2(√a, √(1−a))
distance = R · c          (R = 6,371,000 m)
```

Consecutive points are summed to get the full path length.

---

## Managing the database

Schema migrations are managed directly in the **Supabase dashboard** (SQL editor or Table editor). There are no migration files in this repository.

To make a schema change:
1. Log into the Supabase dashboard.
2. Navigate to **SQL Editor**.
3. Write and execute your migration SQL.
4. Update this document to reflect the change.
