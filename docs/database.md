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

**RLS policies (live Supabase):**
- `SELECT` — active routes publicly readable (`is_active = true`)
- `INSERT` — authenticated, `WITH CHECK (auth.uid() = creator_id)`
- `UPDATE` — authenticated creators only: `USING` / `WITH CHECK` must allow the row **after** the update. For soft-delete, `WITH CHECK` must **not** require `is_active = true`, or setting `is_active = false` will fail under RLS. See [fix_routes_soft_delete_rls.sql](sql/fix_routes_soft_delete_rls.sql).

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

### `route_images`

Photos attached to a route for preview/detail galleries. Files live in Supabase Storage (recommended bucket: `route-photos`); the API registers metadata via `POST /api/v1/routes/:id/images` after a client upload.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID (PK) | |
| `route_id` | UUID (FK → `routes.id`) | Cascades on delete |
| `storage_path` | text | Path/key in storage (often prefixed with bucket name) |
| `public_url` | text | Public or signed URL returned to clients |
| `sort_order` | int | Gallery ordering |
| `created_at` | timestamptz | |
| `created_by` | UUID (FK → `profiles.id`) | Optional |

See `backend/docs/sql/route_images.sql` for a starter DDL and RLS policies.

---

### `route_notes`

Geo-tagged notes attached to a route by the route creator. Each note is pinned to a specific coordinate along the route path and is publicly readable by anyone.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID (PK) | Auto-generated (`gen_random_uuid()`) |
| `route_id` | UUID (FK → `routes.id`) | Parent route (cascades on delete) |
| `author_id` | UUID (FK → `profiles.id`) | Note author; must equal the route's `creator_id` (enforced in the Express layer) |
| `content` | text | Note text (non-empty, enforced by DB check constraint) |
| `location` | geography (PostGIS Point) | Coordinate snapped to the route path; written via `create_route_note_with_geography` RPC |
| `created_at` | timestamptz | Row creation timestamp |
| `updated_at` | timestamptz | Last edit timestamp (`NULL` if never edited) |

**RLS policies:**
- `SELECT` — public (no auth required)
- `INSERT` / `UPDATE` / `DELETE` — authenticated users where `auth.uid() = author_id`

**Index:** B-tree on `route_id` (`route_notes_route_id_idx`) for fast per-route lookups.

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

**RLS policies (live Supabase):**
- `SELECT` — public
- `INSERT` — permissive insert policy (ensure API only sends valid pairs)
- `DELETE` — authenticated route creators may delete join rows for their routes (`EXISTS` route where `creator_id = auth.uid()`), required for `PATCH /routes/:id` tag replacement

---

### `saved_routes`

Bookmarks: which routes a user has saved from the feed.

| Column | Type | Notes |
|---|---|---|
| `user_id` | UUID (FK → `profiles.id`) | |
| `route_id` | UUID (FK → `routes.id`) | |

**Unique constraint:** `(user_id, route_id)` — required for `POST /api/v1/routes/:id/save`, which uses PostgREST `upsert` with `onConflict: 'user_id,route_id'`. Ensure this exists in Supabase.

**RLS:** Writes should allow the authenticated user to insert/delete their own rows (`auth.uid() = user_id`) when the API uses `createUserClient` with the caller’s JWT. **`SELECT`** should allow each user to read their own rows (`auth.uid() = user_id`), or the server cannot enrich `is_saved` on the feed using the user JWT. Alternatively, keep `SELECT` public for `saved_routes` if acceptable for your threat model.

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

**RLS policies (live Supabase):**
- `SELECT` — public
- `INSERT` — authenticated, `WITH CHECK (auth.uid() = user_id)`
- `DELETE` — authenticated users may delete their own rows (`auth.uid() = user_id`); required because the API clears existing votes before inserting a new one when changing direction

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

### `campus_events`

Point-in-time campus events reported by users (crime, crowds, construction, etc.). Events expire automatically based on a user-chosen duration.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID (PK) | Auto-generated (`gen_random_uuid()`) |
| `reporter_id` | UUID (FK → `profiles.id`) | Nullable; set to `NULL` on profile deletion |
| `type` | text | `'crime'`, `'crowd'`, `'line'`, `'construction'`, `'other'` (DB check constraint) |
| `description` | text | Optional free-text detail (nullable) |
| `location` | geography (PostGIS Point) | Written via the `create_event_with_geography` RPC |
| `location_label` | text | Human-readable location name (nullable) |
| `route_id` | UUID (FK → `routes.id`) | Nullable — populated when filed during active navigation |
| `duration_minutes` | integer | User-chosen expiry window (positive integer) |
| `expires_at` | timestamptz | Computed server-side: `NOW() + duration_minutes * interval '1 minute'` |
| `is_active` | boolean | Soft-deactivation flag (default `true`) |
| `created_at` | timestamptz | |

**Indexes:** `GIST` on `location` (`campus_events_location_idx`) for `ST_DWithin` spatial queries; composite B-tree on `(is_active, expires_at)` (`campus_events_active_expires_idx`) for active-event filters.

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

Mutual friendship requests and accepted friendships between users.

| Column | Type | Notes |
|---|---|---|
| `requester_id` | UUID (PK, FK → `profiles.id`) | User who initiated the friend request |
| `addressee_id` | UUID (PK, FK → `profiles.id`) | User who received the friend request |
| `status` | text | `'pending'` or `'accepted'`; accepted rows represent mutual friendships |
| `created_at` | timestamptz | |

**Primary key:** composite `(requester_id, addressee_id)` — one directed request row per user pair.

`pending` means the addressee has not accepted yet. `accepted` means the two users are friends; friend lookups should treat either side of the row as the same mutual relationship.

The `GET /api/v1/users/me` endpoint queries this table for rows where the user is either `requester_id` or `addressee_id` and `status = 'accepted'` to compute `stats.friends_count`.

---

## RPC functions

Supabase database functions are called via `supabase.rpc(...)`. They exist to work around the Supabase JS client's inability to construct or read PostGIS `geography` values directly.

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

### `create_event_with_geography`

Inserts a new row into `campus_events`, sets the PostGIS `geography` point, and computes `expires_at`. Called by `POST /api/v1/events` because the Supabase JS client cannot construct PostGIS geography types directly.

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `p_reporter_id` | UUID | Authenticated user's ID |
| `p_type` | text | Event type (`crime`, `crowd`, `line`, `construction`, `other`) |
| `p_description` | text | Optional free-text detail (nullable) |
| `p_location_label` | text | Human-readable location name (nullable) |
| `p_lng` | double precision | Longitude of the event |
| `p_lat` | double precision | Latitude of the event |
| `p_route_id` | UUID | Optional associated route (nullable) |
| `p_duration_minutes` | integer | Expiry window in minutes |

**Returns:** the new event's UUID.

**SQL:**

```sql
CREATE OR REPLACE FUNCTION create_event_with_geography(
  p_reporter_id     uuid,
  p_type            text,
  p_description     text,
  p_location_label  text,
  p_lng             double precision,
  p_lat             double precision,
  p_route_id        uuid,
  p_duration_minutes integer
)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO campus_events (
    reporter_id, type, description, location, location_label,
    route_id, duration_minutes, expires_at
  ) VALUES (
    p_reporter_id, p_type, p_description,
    ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
    p_location_label, p_route_id, p_duration_minutes,
    now() + (p_duration_minutes * interval '1 minute')
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
```

---

### `get_events_near`

Returns active, non-expired `campus_events` within a radius of a reference coordinate. Called by `GET /api/v1/events` when `lat` and `lng` query parameters are provided. Returns decoded `lat`/`lng` floats instead of the opaque PostGIS geography column.

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `p_lat` | double precision | Latitude of the centre point |
| `p_lng` | double precision | Longitude of the centre point |
| `p_radius_meters` | double precision | Search radius in metres (default `500`) |

**Returns:** table of event rows with `lat` and `lng` as plain floats.

**SQL:**

```sql
CREATE OR REPLACE FUNCTION get_events_near(
  p_lat           double precision,
  p_lng           double precision,
  p_radius_meters double precision DEFAULT 500
)
RETURNS TABLE (
  id uuid, reporter_id uuid, type text, description text,
  lat double precision, lng double precision,
  location_label text, route_id uuid, duration_minutes integer,
  expires_at timestamptz, is_active boolean, created_at timestamptz
)
LANGUAGE sql STABLE AS $$
  SELECT e.id, e.reporter_id, e.type, e.description,
    ST_Y(e.location::geometry) AS lat,
    ST_X(e.location::geometry) AS lng,
    e.location_label, e.route_id, e.duration_minutes,
    e.expires_at, e.is_active, e.created_at
  FROM campus_events e
  WHERE e.is_active = true AND e.expires_at > now()
    AND ST_DWithin(
      e.location,
      ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
      p_radius_meters
    );
$$;
```

---

### `list_active_events`

Returns all active, non-expired `campus_events` ordered by `created_at` descending. Called by `GET /api/v1/events` when no spatial filter is provided. Returns decoded `lat`/`lng` floats.

**Parameters:** none.

**Returns:** table of event rows with `lat` and `lng` as plain floats.

**SQL:**

```sql
CREATE OR REPLACE FUNCTION list_active_events()
RETURNS TABLE (
  id uuid, reporter_id uuid, type text, description text,
  lat double precision, lng double precision,
  location_label text, route_id uuid, duration_minutes integer,
  expires_at timestamptz, is_active boolean, created_at timestamptz
)
LANGUAGE sql STABLE AS $$
  SELECT e.id, e.reporter_id, e.type, e.description,
    ST_Y(e.location::geometry) AS lat,
    ST_X(e.location::geometry) AS lng,
    e.location_label, e.route_id, e.duration_minutes,
    e.expires_at, e.is_active, e.created_at
  FROM campus_events e
  WHERE e.is_active = true AND e.expires_at > now()
  ORDER BY e.created_at DESC;
$$;
```

---

### `create_route_note_with_geography`

Inserts a new row into `route_notes` and sets the PostGIS `geography` point. Called by `POST /api/v1/routes/:id/notes` because the Supabase JS client cannot construct PostGIS geography types directly.

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `p_route_id` | UUID | Parent route |
| `p_author_id` | UUID | Authenticated user's ID |
| `p_content` | text | Note text |
| `p_lat` | double precision | Latitude of the note pin |
| `p_lng` | double precision | Longitude of the note pin |

**Returns:** the new note's UUID.

**SQL:**

```sql
CREATE OR REPLACE FUNCTION create_route_note_with_geography(
  p_route_id   uuid,
  p_author_id  uuid,
  p_content    text,
  p_lat        double precision,
  p_lng        double precision
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO route_notes (route_id, author_id, content, location)
  VALUES (
    p_route_id,
    p_author_id,
    p_content,
    ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
```

---

### `get_route_notes`

Returns all notes for a route with `lat`/`lng` decoded from PostGIS, ordered by `created_at` ascending. Called by `GET /api/v1/routes/:id/notes`.

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `p_route_id` | UUID | Parent route |

**Returns:** table of `{ id, route_id, author_id, content, lat, lng, created_at, updated_at }`.

**SQL:**

```sql
CREATE OR REPLACE FUNCTION get_route_notes(
  p_route_id uuid
)
RETURNS TABLE (
  id          uuid,
  route_id    uuid,
  author_id   uuid,
  content     text,
  lat         double precision,
  lng         double precision,
  created_at  timestamptz,
  updated_at  timestamptz
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    n.id,
    n.route_id,
    n.author_id,
    n.content,
    ST_Y(n.location::geometry) AS lat,
    ST_X(n.location::geometry) AS lng,
    n.created_at,
    n.updated_at
  FROM route_notes n
  WHERE n.route_id = p_route_id
  ORDER BY n.created_at ASC;
$$;
```

---

### `get_routes_between`

Returns the IDs of active routes whose `start_point` falls within `p_from_radius` metres of the origin **and** whose `end_point` falls within `p_to_radius` metres of the destination. Called by `GET /api/v1/routes/search`.

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `p_from_lat` | double precision | Latitude of the origin |
| `p_from_lng` | double precision | Longitude of the origin |
| `p_to_lat` | double precision | Latitude of the destination |
| `p_to_lng` | double precision | Longitude of the destination |
| `p_from_radius` | double precision | Search radius around origin in metres (default `300`) |
| `p_to_radius` | double precision | Search radius around destination in metres (default `300`) |

**Returns:** table of `{ id uuid }` — one row per matching active route.

**Indexes required:** `GIST` index on both `routes.start_point` and `routes.end_point` (both are present in the live database as `routes_start_point_idx` and `routes_end_point_idx`).

**SQL:**

```sql
CREATE OR REPLACE FUNCTION get_routes_between(
  p_from_lat double precision, p_from_lng double precision,
  p_to_lat double precision,   p_to_lng double precision,
  p_from_radius double precision DEFAULT 300,
  p_to_radius   double precision DEFAULT 300
)
RETURNS TABLE(id uuid)
LANGUAGE sql STABLE AS $$
  SELECT r.id FROM routes r
  WHERE r.is_active = true
    AND ST_DWithin(r.start_point,
          ST_SetSRID(ST_MakePoint(p_from_lng, p_from_lat), 4326)::geography, p_from_radius)
    AND ST_DWithin(r.end_point,
          ST_SetSRID(ST_MakePoint(p_to_lng, p_to_lat), 4326)::geography, p_to_radius);
$$;
```

---

### `get_routes_near`

Returns the IDs of active routes whose `start_point` falls within a given radius of a reference coordinate, using PostGIS `ST_DWithin`. Called by `GET /api/v1/routes` when `lat` and `lng` query parameters are provided, and by `GET /api/v1/routes/search` as a proximity fallback when no full origin-to-destination match is found.

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

Database schema, RLS policies, and SQL functions are managed directly in **Supabase** using the dashboard SQL editor or an authenticated Supabase MCP session. This repository does not store or apply migration files.

To make a database change:
1. Apply the change directly in Supabase.
2. Verify the live schema or function in the Supabase dashboard.
3. Update this document and any affected API docs to match the live database state.
