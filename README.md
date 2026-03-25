<p align="center">
  <h1 align="center">@eggermarc/better-auth-usage</h1>
  <p align="center">Usage tracking, feature gating & real-time metering for <a href="https://www.better-auth.com/">BetterAuth</a></p>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@eggermarc/better-auth-usage"><img src="https://img.shields.io/npm/v/@eggermarc/better-auth-usage?style=flat-square&color=blue" alt="npm version" /></a>
  <a href="https://github.com/EggerMarc/better-auth-usage/actions"><img src="https://img.shields.io/badge/tests-135%20passing-brightgreen?style=flat-square" alt="tests" /></a>
  <a href="https://github.com/EggerMarc/better-auth-usage/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/@eggermarc/better-auth-usage?style=flat-square" alt="license" /></a>
</p>

---

> **v0.2.0** — WebSocket-first transport, React hooks, global auth (`authorizeUser`), auto-discovery, event logging with timing. See [what changed](#whats-new-in-v02).

---

## Architecture

```
Client ──WebSocket──→ Socket.IO Server ──→ Effect Pipeline ──→ Redis (Lua, <10ms)
  │                                                              ↓
  └──REST fallback──→ BetterAuth Endpoint ──→ Same Pipeline    WAL Stream (XADD)
                                                                 ↓
                                                          WAL Worker (subscribe/poll)
                                                                 ↓
                                                          DB: usage + usage_event
```

- **Redis-primary**: Atomic Lua script handles increment, reset check, WAL append, and pub/sub in a single `EVAL`
- **WAL durability**: Redis Stream write-ahead log, drained to DB by a serialized background worker
- **WebSocket-first**: Full API over Socket.IO (check, consume, use-feature) with REST fallback
- **Auto-discovery**: Client discovers WS URL from server via `/usage/ws` endpoint
- **DB fallback**: Works without Redis — just slower
- **Effect runtime**: Typed errors, composable pipelines, structured concurrency via [Effect](https://effect.website/)

## Installation

```bash
bun add @eggermarc/better-auth-usage
# or
npm add @eggermarc/better-auth-usage
```

## Quick Start

### Server (`auth.ts`)

```typescript
import { betterAuth } from "better-auth"
import { usage } from "@eggermarc/better-auth-usage"

export const auth = betterAuth({
    plugins: [usage({
        features: {
            "api-calls": { reset: "monthly", resetValue: 0 },
            "storage": {},                    // limits defined per plan
            "credits": { minLimit: -10 },     // global min, plan-specific max
        },
        overrides: {
            "starter": {
                features: {
                    "api-calls": { maxLimit: 1_000 },
                    "storage": { maxLimit: 500 },
                    "credits": { maxLimit: 50 },
                },
            },
            "pro": {
                features: {
                    "api-calls": { maxLimit: 100_000 },
                    "storage": { maxLimit: 5_000 },
                    "credits": { maxLimit: 500 },
                },
            },
        },
        // Optional: authorize user→referenceId access
        authorizeUser: async ({ userId, referenceId }) => {
            return userId === referenceId // or check org membership, etc.
        },
        // Optional: Redis for sub-10ms writes + real-time WS
        cacheOptions: {
            redisUrl: process.env.REDIS_URL!,
            enableRealtime: true,
            port: 3178,
            wal: { enabled: true, drainStrategy: "subscribe" },
        },
    })]
})
```

> Features no longer need a `key` field — it's derived from the object key automatically. Empty features (`{}`) are valid; define limits per plan in `overrides`.

### Client (`auth-client.ts`)

```ts
import { createAuthClient } from "better-auth/react"
import { usageClient } from "@eggermarc/better-auth-usage/client"

export const authClient = createAuthClient({
    plugins: [usageClient()],
})
```

### React (`providers.tsx`)

```tsx
import { createUsageProvider } from "@eggermarc/better-auth-usage/react"
import type { auth } from "./auth"

// Type-safe hooks — feature keys autocomplete from your server config
export const { UsageProvider, useFeature, useSetReference, useAllEvents } =
    createUsageProvider<typeof auth>()
```

```tsx
// Wrap your app
<UsageProvider referenceId={session.user.id}>
    <App />
</UsageProvider>
```

```tsx
// Use in any component
const { usage, consume, events } = useFeature("api-calls")

usage?.status   // "in-limit" | "above-max-limit" | "below-min-limit"
usage?.current  // 42
usage?.max      // 1000
usage?.percent  // 4

await consume(1)         // atomic check + consume via WS (REST fallback)
await consume(10)        // consume 10
await consume(-5)        // refund 5

events           // [{ type: "consume", data: {...}, duration: 2.3, ts: ... }]
```

```tsx
// Switch reference context (e.g., org → personal)
const setReference = useSetReference()
setReference("org-456", "org")
```

## Authentication

All endpoints and WebSocket connections require authentication. The plugin works with every BetterAuth auth method:

| Method | How it works |
|--------|-------------|
| **Session cookies** | Standard browser auth — works automatically |
| **Bearer tokens** | `Authorization: Bearer <token>` via bearer plugin |
| **API keys** | `x-api-key: <key>` via API key plugin |
| **JWTs** | Via bearer plugin, JWT plugin issues tokens |
| **Anonymous** | Via anonymous plugin — real sessions, no login required |

All methods produce the same `ctx.context.session.user.id` — the `authorizeUser` callback works identically regardless of auth method.

### WebSocket Auth

The client auto-fetches a session token via `GET /get-session` and passes it in the Socket.IO handshake. No manual token management needed.

### Anonymous Usage

For free-tier / unauthenticated usage, enable BetterAuth's `anonymous()` plugin. Anonymous users get real sessions with real user IDs — same auth pipeline, no special endpoints, no spoofable referenceIds.

```ts
// Server
import { anonymous } from "better-auth/plugins/anonymous"
plugins: [anonymous(), usage({ ... })]

// Client — auto sign-in
await authClient.signIn.anonymous()
```

## Authorization

The optional `authorizeUser` callback validates that an authenticated user can act on a given referenceId:

```ts
usage({
    authorizeUser: async ({ userId, referenceId, referenceType, feature }) => {
        // e.g., check if user belongs to org
        return db.orgMembers.exists({ userId, orgId: referenceId })
    },
})
```

If not provided, all authenticated users can act on any referenceId. Returns `false` → 403 Forbidden. Throws → 500 Internal Server Error.

## Hooks

Features support `before` and `after` hooks for custom business logic:

```ts
features: {
    "storage": {
        hooks: {
            before: ({ usage, feature }) => {
                // Block consumption beyond limit
                if (usage.afterAmount > (feature.maxLimit ?? Infinity)) {
                    throw new Error("Storage limit exceeded — upgrade your plan")
                }
            },
            after: ({ usage, feature }) => {
                // Send notification, log analytics, etc.
            },
        },
    },
}
```

> The plugin does **not** block on over-limit by default. Consumption always succeeds and returns the `status`. Use a `before` hook to enforce hard limits.

## REST Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/usage/use-feature` | POST | Consume usage (atomic) |
| `/usage/consume` | POST | Raw consume (no limit check) |
| `/usage/check` | POST | Check current usage vs limits |
| `/usage/can-use` | POST | Entitlement check (read-only) |
| `/usage/upsert-customer` | POST | Create or update customer + plan |
| `/usage/check-customer` | POST | Get customer by referenceId |
| `/usage/features` | GET | List all features |
| `/usage/features/:key` | GET | Get single feature (query: `?overrideKey=pro`) |
| `/usage/sync` | POST | Trigger reset if due |
| `/usage/ws` | GET | WebSocket server URL discovery |

## WebSocket API

All operations available over WebSocket with request-response correlation:

| Client Event | Server Response | Description |
|---|---|---|
| `use-feature` | `use-feature:result` | Consume usage |
| `consume` | `consume:result` | Raw consume |
| `check` | `check:result` | Check usage |
| `can-use` | `can-use:result` | Entitlement check |
| `subscribe:usage` | `subscribed` | Subscribe to live updates |
| — | `usage:updated` | Real-time push on any change |

## Plan Transitions

When a customer's `overrideKey` changes (including removal):

```ts
features: {
    "api-calls": { onPlanChange: "carry-over" },  // default — usage stays, limits change
    "credits": { onPlanChange: "reset" },          // usage resets to resetValue
}
```

## Reset Strategies

All boundaries computed in **UTC**.

| Reset | Boundary |
|-------|----------|
| `hourly` | Start of next UTC hour |
| `6-hourly` | Next 6-hour block |
| `daily` | Tomorrow 00:00 UTC |
| `weekly` | Next Monday 00:00 UTC |
| `monthly` | 1st of next month |
| `quarterly` | 1st of next quarter |
| `yearly` | January 1st next year |
| `never` | Never resets |

## Redis

Optional. Without it, the plugin works in DB-only mode.

With Redis:
- **Lua scripts** for atomic increment + reset (<1ms)
- **Redis Streams** as WAL for durable DB sync
- **Pub/sub** for real-time WebSocket broadcasts
- **Socket.IO** server for full WS API

```ts
cacheOptions: {
    redisUrl: "redis://localhost:6379",
    enableRealtime: true,    // Socket.IO server
    port: 3178,              // WS server port (auto-discovered by client)
    wal: {
        enabled: true,
        drainStrategy: "subscribe",  // zero idle cost (default)
    },
}
```

## DB Schema

Registered via BetterAuth's schema system:

- **`usage`** — one row per (referenceId, feature): current total, last reset, WAL stream ID
- **`usage_event`** — append-only history: deltas, events, overrideKey for billing
- **`customer`** — referenceId → plan mapping with optional metadata

## What's New in v0.2

- **WebSocket-first transport** — full API over Socket.IO with REST fallback
- **React hooks** — `useFeature`, `useSetReference`, `useAllEvents` with typed feature keys from server config
- **Global auth** — `authorizeUser` callback replaces per-feature `authorizeReference`
- **WS auto-discovery** — client discovers WS URL from server, fetches session token automatically
- **Event logging** — per-feature event log with round-trip timing
- **Request correlation** — concurrent WS operations don't cross-resolve
- **No more `key`** — feature key derived from config object key
- **No more thresholds/blocked** — userland responsibility, not ours
- **Monotonic WAL guard** — `walStreamId` prevents stale overwrites on replay
- **Serialized WAL drain** — no more overlapping drains from pub/sub
- **Session middleware fix** — `middleware:` → `use:` (was silently ignored)

## Development

```bash
bun run build              # Build (tsup — index, client, react)
bun run test               # 135 tests (no Docker needed)
bun run test:redis         # 11 Redis integration tests (needs Redis on port 6399)
bun run test:perf          # Performance benchmarks
```

## License

MIT
