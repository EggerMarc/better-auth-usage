# better-auth-usage — Next.js Example

Live demo of the usage tracking plugin with anonymous auth, GitHub OAuth, plan switching, and real-time WebSocket updates.

## Setup

### 1. Environment

Copy `.env.example` or create `.env`:

```env
BETTER_AUTH_SECRET=your-secret-at-least-32-chars
BETTER_AUTH_URL=http://localhost:3002
DATABASE_URL=postgresql://user:pass@localhost:5432/dbname
CACHE_REDIS=redis://localhost:6379

# Optional: GitHub OAuth
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
```

### 2. Services

```bash
# Postgres + Redis
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=pass -e POSTGRES_DB=dbname postgres:16-alpine
docker run -d -p 6379:6379 redis:7-alpine
```

### 3. Run

```bash
# From repo root — build the plugin first
bun run build

# Then run the example
cd examples/nextjs
bun install
bun run dev
```

Open [http://localhost:3002](http://localhost:3002).

## What it Demonstrates

- **Anonymous sessions** — auto sign-in via BetterAuth's `anonymous()` plugin
- **GitHub OAuth** — sign in to get plan switching
- **Plan switching** — starter/pro plans change limits in real-time
- **React hooks** — `useFeature("api-calls")` returns `{ usage, consume, events }`
- **Type-safe** — feature keys autocomplete from server config via `createUsageProvider<typeof auth>()`
- **Event log** — all consume events with round-trip timing (ms)
- **WebSocket transport** — operations route through WS when connected, REST fallback
- **Hooks** — `storage` feature has a `before` hook that blocks on over-limit

## Stack

- Next.js 16 (Turbopack)
- BetterAuth + anonymous + usage plugins
- PostgreSQL (Drizzle adapter)
- Redis (Lua scripts, WAL, Socket.IO)
- React 19
