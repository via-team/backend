# VIA Backend

REST API for the VIA route-sharing app: **Node.js + Express**, **Supabase** (PostgreSQL + PostGIS), versioned routes under `/api/v1/`. Interactive docs are served at `/api-docs` (Swagger UI).

Full documentation lives in **[`docs/`](./docs/README.md)** — start with [Getting started](./docs/getting-started.md), [API reference](./docs/api-reference.md), and [Architecture](./docs/architecture.md).

Developed as a TPEO new fellow project. 
- View [Case Study](https://www.canva.com/design/DAHGbFfQRRQ/XSasy5UyFarP8bW3wmdVTw/view?utm_content=DAHGbFfQRRQ&utm_campaign=designshare&utm_medium=link&utm_source=viewer)
- Learn more about [TPEO](https://www.txproduct.org/)

## Prerequisites

- Node.js v18 or later
- npm
- Supabase project credentials (URL + anon key)

## Setup

```bash
npm install
```

Create a `.env` file in this directory. See [Getting started — environment variables](./docs/getting-started.md#3-configure-environment-variables) for the complete list (`PORT`, `SUPABASE_*`, `ALLOWED_ORIGINS`, `TRUST_PROXY`, rate limits, etc.).

## Run

| Command | Description |
| --- | --- |
| `npm start` | Production — `node src/index.js` |
| `npm run dev` | Development — nodemon, default `http://localhost:3000` (override with `PORT`) |
| `npm run lint` | ESLint on `src/` |
| `npm test` | Jest tests |
| `npm run generate:campus-places` | Generate campus places data (`scripts/generate_campus_places.js`) |

**Deployed API (Render):** https://via-backend-2j3d.onrender.com — [Swagger](https://via-backend-2j3d.onrender.com/api-docs), [health](https://via-backend-2j3d.onrender.com/health).

## System endpoints

- `GET /` — API info (`{ "message": "VIA API" }`)
- `GET /health` — Liveness (`{ "status": "ok" }`)
- `GET /api-docs` — Swagger UI

## API overview (`/api/v1/`)

Protected routes expect `Authorization: Bearer <supabase_access_token>`. Details, request bodies, and examples are in [`docs/api-reference.md`](./docs/api-reference.md).

| Area | Endpoints |
| --- | --- |
| **Tags** | `GET /tags` — lookup tags for filters / pickers (public) |
| **Auth** | `POST /auth/verify-school-email` — school domain check before signup (public) |
| **Users** | `GET /users/me`, `GET /users/me/friends`, `POST /users/friends/request`, `POST /users/friends/:id/accept`, `DELETE /users/friends/:id` (auth) |
| **Routes** | `POST /routes` (auth); `GET /routes`, `GET /routes/search`, `GET /routes/feed` (friends tab auth); `GET /routes/:id` (public); `PATCH` / `DELETE /routes/:id` (creator, auth); `POST /routes/:id/vote` (auth); `GET /routes/:id/comments` (public), `POST …/comments` (auth); `GET /routes/:id/notes` (public), `POST` / `PATCH` / `DELETE …/notes/:noteId` (creator, auth) |
| **Events** | `GET /events` (public); `POST /events`, `DELETE /events/:id` (auth) |

Manual shell scripts (with the server running): `test-routes-get.sh`, `test-users-me.sh` — see [Getting started](./docs/getting-started.md#running-the-test-scripts).

## Environment variables

**Required for normal operation**

- `SUPABASE_URL` — Supabase project URL  
- `SUPABASE_ANON_KEY` — Supabase anon (public) key  

**Common**

- `PORT` — listen port (default `3000`)
- `ALLOWED_ORIGINS` — comma-separated browser origins for CORS (set explicitly in production)
- `TRUST_PROXY` — set when behind a reverse proxy (e.g. Render); see [Getting started](./docs/getting-started.md)
- `JSON_BODY_LIMIT` — Express JSON body size limit (default `1mb`)

**Optional rate limits** — `RATE_LIMIT_*` variables documented in [Getting started](./docs/getting-started.md#3-configure-environment-variables).

## More documentation

| Doc | Topic |
| --- | --- |
| [`docs/README.md`](./docs/README.md) | Index of all backend docs |
| [`docs/getting-started.md`](./docs/getting-started.md) | Local setup, verification, troubleshooting |
| [`docs/api-reference.md`](./docs/api-reference.md) | Every endpoint, auth, and examples |
| [`docs/database.md`](./docs/database.md) | Schema, RPCs, PostGIS |
| [`docs/architecture.md`](./docs/architecture.md) | Structure, stack, request flow |
| [`docs/ci-cd.md`](./docs/ci-cd.md) | GitHub Actions and CI |
| [`docs/contributing.md`](./docs/contributing.md) | Conventions and roadmap |
