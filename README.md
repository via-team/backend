# Backend

Express.js API server.

## Setup

```bash
npm install
```

## Run

- **Production:** `npm start`
- **Development (with auto-reload):** `npm run dev`

Server runs at `http://localhost:3000` by default. Set `PORT` to override.

## Endpoints

- `GET /` — API info
- `GET /health` — Health check
- `GET /api-docs` — Swagger API documentation

### Routes
- `POST /api/v1/routes` — Create a new route
- `GET /api/v1/routes` — Search and list routes
- `GET /api/v1/routes/:id` — Get specific route details
- `POST /api/v1/routes/:id/vote` — Vote on a route
- `POST /api/v1/routes/:id/comments` — Comment on a route

### Users
- `GET /api/v1/users/me` — Get current user profile and stats
- `POST /api/v1/users/friends/request` — Send friend request

### Auth
- `POST /api/v1/auth/verify-school-email` — Verify school email domain

## Documentation

- See `docs/users-endpoints.md` for detailed user endpoint documentation
- API documentation is available at `/api-docs` when the server is running

## Environment Variables

Need to configure:

- `PORT` - Server port (default: 3000)
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_ANON_KEY` - Your Supabase anonymous key
