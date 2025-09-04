# Table

A Next.js + React + TypeScript poker application with real‑time play (Socket.IO), REST API routes, and a PostgreSQL‑backed data layer. Includes rich test coverage with Jest and a modular database/migration design.

## Quick start

Prerequisites
- Node.js 18+ and npm
- (Optional for local dev) PostgreSQL 13+ if you want to hit DB‑backed API routes

1) Install dependencies

```bash
npm install
```

2) Configure environment

Create a file named `.env.local` in the project root with either a mock DB (fastest) or a real PostgreSQL connection.

Mock DB (no Postgres required; many features and tests work):
```
# Forces internal DB helpers to use an in‑memory mock
USE_MOCK_DB=true
```

Real PostgreSQL (used by API routes that call pg.Pool directly):
```
# Standard pg variables (preferred by pg.Pool)
PGHOST=localhost
PGPORT=5432
PGDATABASE=app
PGUSER=postgres
PGPASSWORD=your_password
# Use "require" for managed providers that require SSL
PGSSLMODE=disable

# Optional alternative variable names used by some internal helpers
DB_HOST=localhost
DB_PORT=5432
DB_NAME=app
DB_USER=postgres
DB_PASSWORD=your_password
DB_SSL=false
```

3) Start the app in development

```bash
npm run dev
```

Open http://localhost:3000 in your browser.

## Running tests

- Full test suite
```bash
npm test
```

- With coverage
```bash
npm run test:coverage
```

The repository enforces global coverage thresholds; run the full suite to satisfy them.

## Build and run (production)

1) Build
```bash
npm run build
```

2) Start
```bash
npm run start
```

Ensure production environment variables are set (see Environment section above).

## Database schema

The schema is defined by user stories in `docs/user_stories/05_DATABASE_SCHEMA.md` and additional feature migrations in `src/lib/database/migrations/` (e.g., chat, friend invites, social). For a new environment:

- Create your database and run the SQL from the user story file for core tables:
  - Users and auth tokens (US‑017)
  - Avatars and versions (US‑018)
  - Friends and blocks (US‑019)
  - Rooms and active games (US‑020)
  - Hand history and run‑it‑twice outcomes (US‑021)
  - Player statistics and achievements (US‑022)
  - Chat messages (US‑023)
  - Rabbit hunt history and feature cooldowns (+ concurrent unique index)

- Social sharing and engagement (US‑065) tables exist in code migrations (`src/lib/database/migrations/social-tables.ts`). Create equivalent tables in PostgreSQL if you plan to use social APIs:
  - `social_shares` (user_id, kind, ref_id, visibility, message, platforms[], payload, share_slug, created_at)
  - `social_engagement` (share_id, metric, count, last_updated) with unique (share_id, metric)

Note: A simple mock migration runner exists for tests, but a production migration tool (e.g., Prisma Migrate, Knex, Flyway) is recommended for applying SQL in real environments.

### Recommended apply order (SQL)

Apply these in order (via Supabase SQL editor or psql):

1) Core schema
  - `src/lib/database/schema/full-schema.sql`
    - Includes all core tables and indexes; uses `pgcrypto`/`gen_random_uuid()`.
2) Access control (RLS)
  - `src/lib/database/schema/user-management.sql`
  - `src/lib/database/schema/game-access.sql`
    - Idempotent policies and views; safely re-runnable.
3) Optional feature add-ons
  - `src/lib/database/migrations/010_game_history.sql` (game history + analytics)
  - `src/lib/database/migrations/043_query_performance.sql` (extra indexes)
  - Any other feature-specific `.sql` files you choose to enable

Notes
- The TypeScript files in `src/lib/database/migrations/*.ts` are config objects used by tests. They aren’t wired to a production CLI; prefer the SQL files above. If you want a code-driven runner, open an issue and we’ll add a small Node/pg script to execute selected configs.

## Realtime (Socket.IO)

The app uses Socket.IO for chat and invites. When running `npm run dev` or `npm run start`, the Next.js server hosts both API routes and the Socket.IO server. Ensure your deployment target supports long‑lived WebSocket connections.

## Environment variables (summary)

- Mock DB toggle
  - `USE_MOCK_DB=true` — use in‑memory DB for local dev/tests

- PostgreSQL (pg.Pool and helpers)
  - `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGSSLMODE`
  - Alternative helper vars: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL`

## Deployment

Choose one of the options below. Always set the environment variables listed above.

### Option A: Node host (VM or bare metal)

1) Install Node.js 18+ on the server
2) Copy project files to the server (or pull via Git)
3) Install dependencies and build
```bash
npm ci
npm run build
```
4) Configure environment variables (e.g., in a `.env` file and load via your process manager)
5) Start the server with a process manager
```bash
# example with pm2
npx pm2 start npm --name table -- start
npx pm2 save
```
6) Put a reverse proxy (Nginx/Apache) in front and forward HTTP(S) traffic to the Node process

Notes
- Ensure the proxy supports and forwards WebSocket upgrade requests
- Open outbound network access to your PostgreSQL service if remote

### Option B: Docker (example workflow)

A simple approach if you create a Dockerfile:

```dockerfile
# Example only – create this file if you want containerized deploys
FROM node:18-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:18-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:18-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app .
EXPOSE 3000
CMD ["npm", "run", "start"]
```

Run the container (set envs for Postgres):
```bash
docker build -t table:latest .
docker run -p 3000:3000 --env-file .env.production table:latest
```

Ensure your `.env.production` contains the Postgres variables and any other secrets.

### Option C: Vercel (caveat: WebSockets)

- Import the repo into Vercel
- Set environment variables in Project Settings
- Build command: `npm run build`; Output directory: (Next.js default)
- Start command: not required (Vercel manages it)

Important: Vercel’s serverless model may not support long‑lived Socket.IO connections in a single app without additional setup. For real‑time features, consider:
- A separate socket server (Node/Container) deployed to a provider that supports WebSockets
- Or a host like Render, Railway, Fly.io, AWS ECS/Fargate, or a VM

## Troubleshooting

- WebSocket not connecting
  - Verify proxy/WebApp Gateway forwards `Upgrade` requests and `Connection: upgrade`
  - Check CORS/origin settings if you restrict origins

- PostgreSQL SSL errors (self‑signed, etc.)
  - Set `PGSSLMODE=require` for managed providers that mandate SSL
  - For local dev, set `PGSSLMODE=disable` (default)

- Tests fail when running a subset only
  - The project enforces global coverage thresholds; run the full suite (`npm test`) to satisfy them

## Project layout

- `pages/` — Next.js pages and API routes
- `src/` — application code (services, database, utils, components)
- `docs/` — architecture, schema, and feature documentation
- `public/` — static assets and service worker
- `styles/` — Tailwind CSS

## Security

- Never commit secrets; use environment variables in your deployment platform
- Follow guidance in `docs/SECURITY_AUTH.md` and related docs for auth and admin features

## License

See `LICENSE` in the repository.
