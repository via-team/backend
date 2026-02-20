# Getting Started

This guide walks you through setting up the VIA backend on your local machine.

## Prerequisites

- **Node.js** v18 or later ([download](https://nodejs.org/))
- **npm** (bundled with Node.js)
- Access to the team's Supabase project (ask a project lead for credentials)

## Installation

### 1. Clone the repository

```bash
git clone <repo-url>
cd backend
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a `.env` file in the project root:

```bash
cp .env.example .env   # if an example file exists, otherwise create it manually
```

Populate `.env` with the following values:

```env
PORT=3000
SUPABASE_URL=<your-supabase-project-url>
SUPABASE_ANON_KEY=<your-supabase-anon-key>
```

> **Where to find these values:** Log into the [Supabase dashboard](https://supabase.com/dashboard), open the project, and go to **Project Settings → API**. Copy the **Project URL** and the **anon / public** key.

### 4. Start the server

**Development mode** (auto-restarts on file changes via nodemon):

```bash
npm run dev
```

**Production mode:**

```bash
npm start
```

The server starts on `http://localhost:3000` by default (or whatever `PORT` is set to in `.env`).

**Production:** The API is deployed at https://via-backend-2j3d.onrender.com

## Verify the setup

Once running, check these URLs in your browser or with `curl`:

```bash
# Health check — should return {"status":"ok"}
curl http://localhost:3000/health
# Or against production:
curl https://via-backend-2j3d.onrender.com/health

# Root — should return {"message":"VIA API"}
curl http://localhost:3000/

# Interactive Swagger docs
open http://localhost:3000/api-docs
# Production: https://via-backend-2j3d.onrender.com/api-docs
```

## Running the test scripts

The repo ships with two shell scripts for manual endpoint testing. Make them executable first:

```bash
chmod +x test-routes-get.sh test-users-me.sh
```

Then run them while the server is up:

```bash
./test-routes-get.sh   # exercises GET /api/v1/routes with various filters
./test-users-me.sh     # exercises GET /api/v1/users/me
```

## Project scripts

| Command | Description |
|---|---|
| `npm start` | Start the server with Node |
| `npm run dev` | Start the server with nodemon (watches for changes) |

## Common issues

**Server won't start**
- Confirm `.env` exists and `SUPABASE_URL` / `SUPABASE_ANON_KEY` are set.
- Make sure port 3000 isn't already in use: `lsof -i :3000`.

**Supabase errors on requests**
- Double-check the anon key — it's a long JWT string. Ensure there are no trailing spaces or line breaks in `.env`.
- Confirm you have access to the correct Supabase project.

**`nodemon` not found**
- Run `npm install` to ensure dev dependencies are installed.
