# AGENTS.md - better-auth-usage

## What This Project Is

A [BetterAuth](https://www.better-auth.com/) plugin that adds **feature-based usage tracking, metering, and quota enforcement** to any BetterAuth-powered application. It lets you define features with limits, track consumption per customer/reference, automatically reset usage on configurable intervals, and optionally layer in Redis caching and real-time WebSocket updates.

Think: "Stripe metered billing meets auth middleware" — track API calls, clicks, credits, tokens, or any countable resource, enforce quotas, and reset them on schedule.

---

## Project Structure

```
package/                        # The plugin source code
├── index.ts                    # Plugin factory — exports usage(), registers schema + endpoints
├── types.ts                    # All TypeScript types, inferred from Zod schemas
├── schema.ts                   # Zod schemas: customer, usage, cached variants
├── utils.ts                    # Helpers: checkLimit, shouldReset, tryCatch, normalizeData
├── client.ts                   # Client-side plugin (usageClient) with path/method mappings
├── adapters/
│   ├── index.ts                # UsageAdapter factory — wraps BetterAuth's adapter into domain methods
│   ├── cache.ts                # UsageCache class — Redis wrapper (ioredis), Lua script execution
│   ├── lua/
│   │   ├── increment.lua       # Atomic increment + auto-reset in a single Redis eval
│   │   └── set-limit.lua       # (empty placeholder)
│   └── queries/
│       ├── get-usage.ts        # Sum all usage records for a ref+feature (event-sourced total)
│       ├── get-latest-usage.ts # Get the most recent usage row
│       ├── insert-usage.ts     # Create a new usage record (with or without transaction)
│       ├── reset-usage.ts      # Insert a "reset" record that brings the total back to resetValue
│       ├── get-customer.ts     # Fetch customer by referenceId
│       └── upsert-customer.ts  # Create or update customer in a transaction
├── resolvers/                  # Business logic — orchestrates cache, DB, hooks
│   ├── options.ts              # getUsageOptions() — initializes cache, tracker, WS server per-request
│   ├── features.ts             # resolveFeature() — merges base feature with override
│   ├── get-usage.ts            # resolveGetUsage() — cache-first read, backfill cache on miss
│   ├── get-customer.ts         # resolveGetCustomer() — cache-first customer lookup
│   ├── insert-usage.ts         # resolveInsertUsage() — the main consumption pipeline
│   ├── sync-usage.ts           # resolveSyncUsage() — check if reset is due, perform it
│   └── upsert-customer.ts     # resolveUpsertCustomer()
├── endpoints/                  # HTTP API endpoints (BetterAuth createAuthEndpoint)
│   ├── consume-feature.ts      # POST /usage/consume     (requires session)
│   ├── check-usage.ts          # POST /usage/check        (requires session)
│   ├── check-customer.ts       # POST /usage/check-customer (requires session)
│   ├── get-feature.ts          # GET  /usage/features/{featureKey}
│   ├── list-features.ts        # GET  /usage/features
│   ├── sync-usage.ts           # POST /usage/sync         (no auth middleware)
│   ├── upsert-customer.ts      # POST /usage/upsert-customer (requires session)
│   └── index.ts                # Re-exports all endpoint factories
├── middlewares/
│   ├── usage.ts                # Enforces feature.authorizeReference() — currently commented out
│   └── customer.ts             # Validates the customer exists — currently commented out
└── realtime/
    ├── usage-tracker.ts        # Redis pub/sub bridge — publishes + broadcasts usage updates
    └── websocket-server.ts     # Socket.IO server — subscribe/unsubscribe/get usage rooms

tests/                          # Test suite (bun test)
├── test-helper.ts              # Shared setup: in-memory BetterAuth instance, auth, customer helpers
├── utils.test.ts               # Unit tests for checkLimit, shouldReset, tryCatch, normalizeData
├── consume-check.test.ts       # E2E: consume increments, accumulation, decrements, isolation, preview
├── overrides-hooks-customer.test.ts  # Overrides, hooks blocking/firing, customer CRUD
├── sync-reset.test.ts          # Sync with reset=never, recent usage, edge cases
└── cache.test.ts               # Full pipeline with Redis (ioredis-mock): consume, check, hooks, customers

examples/nextjs/                # Demo Next.js app
├── app/page.tsx                # UI with check/consume/+/- buttons
├── lib/auth.ts                 # BetterAuth server config with usage plugin
├── lib/auth-client.ts          # BetterAuth client config with usageClient
└── db/                         # Drizzle ORM setup + schema (Postgres via Neon)

bunfig.toml                     # Bun config — loads .lua files as text (needed for runtime + tests)
```

---

## How It Works

### Plugin Registration

`usage(options)` returns a BetterAuth plugin object with:
- **`id`**: `"usage"`
- **`schema`**: Defines two tables — `usage` and `customer` — that BetterAuth auto-migrates
- **`endpoints`**: Seven HTTP endpoints wired to resolvers

There is no persistent `init()` lifecycle hook. Instead, `getUsageOptions()` lazily initializes cache/tracker/WebSocket per-request when `cacheOptions` is provided.

### Core Data Model

**Usage table** — append-only event log. Each row is a delta, not an absolute value:
- `referenceId` (string) — who (user, org, IP, session, "global")
- `feature` (string) — which feature key
- `amount` (integer) — the delta (+1, -1, or a reset adjustment)
- `event` (string) — "use"/"usage", "reset", or "sync"
- `lastResetAt` (date) — when the counters were last reset
- `createdAt` (date) — row timestamp

The current usage is computed by **summing all `amount` values** for a given (referenceId, feature) pair. This is an event-sourcing pattern — the truth is in the log. Implemented in `get-usage.ts` via `adapter.findMany` + `.reduce()`.

When no usage records exist for a (referenceId, feature) pair, `getUsageQuery` auto-creates an initial "sync" record with `amount: feature.resetValue ?? 0`.

**Customer table** — metadata about who's consuming:
- `referenceId` (string, unique) — the entity identifier
- `referenceType` (string) — logical grouping ("user", "org", "team", "session")
- `email`, `name` (string, optional) — metadata
- `overrideKey` (string, optional) — links to an override set

**Important: A customer must exist before consuming.** The consume pipeline calls `resolveGetCustomer()` which throws NOT_FOUND if the customer hasn't been upserted first. Use `POST /usage/upsert-customer` to create customers before any consumption.

### The Consume Pipeline

The core operation — `POST /usage/consume` — flows through these layers:

```
Endpoint (consume-feature.ts)
  → getUsageOptions()          # Init adapter + cache/tracker if configured
  → resolveFeature()           # Merge base feature + overrides (shallow spread)
  → resolveInsertUsage()       # Main pipeline:
      ├─ resolveGetUsage()     #   1. Load current total (cache → DB fallback)
      ├─ resolveGetCustomer()  #   2. Load customer (cache → DB fallback) — MUST EXIST
      ├─ hooks.before()        #   3. Pre-consumption hook (can throw to block)
      │
      │  [If cache enabled]
      ├─ adapter.insertUsage() #   4a. Fire-and-forget DB write (async, .catch())
      ├─ cache.insertEvent()   #   4b. Atomic Redis increment via Lua script (awaited)
      │
      │  [If no cache]
      ├─ adapter.insertUsage() #   4. Direct DB write (awaited)
      │
      ├─ hooks.after()         #   5. Post-consumption hook
      └─ resolveSyncUsage()    #   6. Async reset check (fire-and-forget, .catch())
```

The `event` field defaults to `"use"` in the endpoint body schema. The adapter writes it as `"usage"` in the DB (hardcoded in the no-cache path at `insert-usage.ts:82`).

### Check Pipeline

`POST /usage/check` resolves the feature (with optional overrideKey), loads usage via `resolveGetUsage()`, then returns:
- `status` — `"in-limit"`, `"above-max-limit"`, or `"below-min-limit"`
- `maxLimit`, `minLimit` — from the resolved feature
- `currentAmount` — the summed usage total

The `amount` body param is optional — if provided, it's added to `currentAmount` for the limit check (preview mode) without actually consuming. This lets clients check "would consuming X put me over the limit?" without side effects.

### Cache Strategy

When `cacheOptions.redisUrl` is provided:
- **Reads**: Cache first. On miss, read from DB, backfill cache with the counter value and limits.
- **Writes**: Write to Redis atomically via Lua script (immediate, awaited), write to DB async (fire-and-forget with `.catch()`).
- **Resets**: The Lua `increment.lua` script handles atomic increment-or-reset: if `now > resetAt`, it resets the counter to `resetValue` before incrementing.

**Redis key structure:**
- `usage:{feature}:{referenceId}` — plain integer counter (read/written by Lua via `GET`/`SET`/`INCRBY`)
- `limit:{feature}:{referenceId}` — hash with limit metadata (`maxLimit`, `minLimit`, `resetValue`, `resetAt`, `lastResetAt`) written via `HSET`
- `customer:{referenceId}` — JSON-serialized customer object (read/written via `GET`/`SET`)

**`getUsage` reads the counter key as a raw number** (not JSON). It then reads the limit hash to compose the `cached_Usage` object. This is important — the Lua script writes plain integers, not JSON.

**`insertEvent`** runs the Lua script which returns `[newAmount, resetAt]`. The method validates and returns a `cached_UsageEvent` with `referenceId`, `feature`, `amount`, and `event`.

Without `cacheOptions`, all reads and writes go directly to the database through BetterAuth's adapter.

### Reset Logic

Features can specify a `reset` interval: `"hourly"`, `"6-hourly"`, `"daily"`, `"weekly"`, `"monthly"`, `"quarterly"`, `"yearly"`, or `"never"`.

`shouldReset()` in `utils.ts` computes the next reset boundary from the current time and checks if `lastResetAt` is before it. `computeNextResetTime()` aligns to calendar boundaries (start of next hour, next Monday 00:00, 1st of next month 00:00, etc.).

When a reset is due, a "reset" event is inserted with `amount = resetValue - currentTotal`, bringing the running sum back to `resetValue` (typically 0). This happens in `resolveSyncUsage()`, called async (fire-and-forget) after each consumption.

`POST /usage/sync` also triggers this manually.

### Feature Overrides

Features are defined globally, but can be overridden per plan/tier/customer using the `overrides` option. **Overrides require a nested `features` key:**

```ts
{
  features: {
    "api-calls": { key: "api-calls", maxLimit: 100, reset: "monthly" }
  },
  overrides: {
    "pro-plan": {
      features: {                    // <-- required nesting
        "api-calls": { maxLimit: 10000 }
      }
    }
  }
}
```

`resolveFeature()` does a shallow merge: `{ ...baseFeature, ...overrideFeature }`. The `overrideKey` is passed per-request by the client in the request body. If the `overrideKey` doesn't exist in `overrides`, the base feature is used unchanged.

### Hooks System

Each feature can define `before` and `after` hooks:
- **before**: Runs pre-consumption with `{ usage: { beforeAmount, afterAmount, amount }, customer, feature }`. Can throw to block the operation — the thrown error propagates up and the consumption is not persisted.
- **after**: Runs post-consumption with the same shape. Useful for side effects (notifications, billing events, logging, etc.).

Hooks are defined per-feature and can also be set in overrides.

### Real-time (Optional)

When `cacheOptions.enableRealtime` is true and `cacheOptions.port` is set:
1. A Socket.IO server starts on `cacheOptions.port`
2. `UsageTracker` creates two separate Redis pub/sub clients (separate from the cache client)
3. Clients connect via WebSocket and emit `subscribe:usage` to join rooms like `usage:{feature}:{referenceId}`
4. Usage updates are published to Redis channels (`usage:updates:{feature}:{referenceId}`) and broadcast to subscribed Socket.IO rooms
5. `feature.authorizeReference()` gates who can subscribe to which rooms
6. Events: `subscribe:usage`, `unsubscribe:usage`, `get:usage` (client→server); `usage:updated`, `usage:current`, `subscribed`, `error` (server→client)

### Endpoints Reference

| Endpoint | Method | Auth | Body | Returns |
|----------|--------|------|------|---------|
| `/usage/features` | GET | none | — | Array of `{ featureKey, details }` |
| `/usage/features/{featureKey}` | GET | none | `{ overrideKey? }` | `{ feature }` (hooks stripped) |
| `/usage/consume` | POST | session | `{ featureKey, referenceId, amount, event?, overrideKey? }` | Usage record |
| `/usage/check` | POST | session | `{ featureKey, referenceId, amount?, overrideKey? }` | `{ status, maxLimit, minLimit, currentAmount }` |
| `/usage/check-customer` | POST | session | `{ referenceId }` | Customer object |
| `/usage/upsert-customer` | POST | session | `{ referenceId, referenceType, name?, email?, overrideKey? }` | Customer object |
| `/usage/sync` | POST | none | `{ featureKey, referenceId, overrideKey? }` | Reset result or error |

Note: The `GET /usage/features/{featureKey}` endpoint has a `body` schema on a GET request, which doesn't work with standard HTTP clients. Use the server API (`auth.api.getFeature()`) directly or send body via POST.

---

## Patterns to Know

### Event Sourcing for Usage
Usage is never updated in place. Every consumption, reset, and sync is an appended row. The current value is the sum of all `amount` fields across all rows for a (referenceId, feature) pair. This gives a full audit trail. Implemented in `getUsageQuery` via `adapter.findMany` + `reduce`.

### Cache-First with Async DB Writeback
When Redis is configured, the response comes from the cache (fast path). The DB write happens in the background with `.catch()` to avoid blocking. This trades strict consistency for latency — the cache is authoritative for reads, and the DB is the durable backup.

### Dual Data Store in Redis
The cache uses two different Redis data structures per feature/reference:
- A plain string key (`usage:*`) holding an integer counter — read/written atomically by the Lua script
- A hash key (`limit:*`) holding limit metadata — written by `setLimit()`, read by the Lua script

`getUsage()` reads the counter key as a raw number and the limit hash separately, then composes the `cached_Usage` object. It does NOT parse JSON from the counter key.

### Atomic Lua Scripts
The `increment.lua` script runs atomically in Redis: it reads the limit hash, checks for reset conditions (if `now > resetAt`), resets the counter to `resetValue` if needed, then increments — all in one `EVAL`. Returns `[newAmount, resetAt]` (resetAt is nil when no reset occurred). The script also sets `EXPIREAT` on the counter key using the resetAt timestamp.

### Resolver Pattern
Business logic lives in `resolvers/`, not in endpoints or adapters. Resolvers compose adapter calls, cache operations, and hooks into coherent workflows. Endpoints are thin — they parse input, call `getUsageOptions()`, resolve the feature, delegate to a resolver, and return the result.

### Lazy Initialization
`getUsageOptions()` is called per-request inside each endpoint handler. It creates the adapter from `ctx.context` (BetterAuth's auth context) and optionally initializes Redis cache, pub/sub tracker, and WebSocket server. This avoids requiring a persistent `init()` lifecycle but means infrastructure is re-initialized on every request.

### tryCatch Wrapper
`utils.ts` exports a `tryCatch<T, E>()` that wraps promises into `Result<T, E>` objects (`{ data: T, error: null } | { data: null, error: E }`). This is used consistently across the codebase to avoid try/catch blocks and enable pattern-matching on success/failure.

### Zod for Validation
All data shapes are defined as Zod schemas in `schema.ts`, with types inferred via `z.infer<>`:
- `customerSchema` — validates customer objects (referenceId, referenceType, email?, name?, overrideKey?)
- `usageSchema` — validates DB usage records (referenceId, feature, amount, event?, createdAt, lastResetAt)
- `cached_usageSchema` — describes the cache usage shape (referenceId, feature, current, lastResetAt, maxLimit?, minLimit?)
- `cached_limitsSchema` — describes the limit hash shape
- `cached_usageEventSchema` — validates cache insert/pub-sub events (referenceId, feature, amount, event?)
- `customerLimitsSchema` — per-customer limits (defined but not wired yet)

Endpoint bodies are validated via Zod schemas passed to `createAuthEndpoint`.

### BetterAuth Adapter Abstraction
The plugin never touches the database directly. It goes through BetterAuth's `Adapter` interface (`findMany`, `findOne`, `create`, `update`, `transaction`, `count`), which works with any BetterAuth-supported database (Postgres, MySQL, SQLite, etc. via Drizzle or other adapters).

---

## Build & Test

### Build
```bash
bun run build    # tsup → dist/index.js + dist/client.js
```

`tsup.config.ts` uses `loader: { '.lua': 'text' }` to inline Lua scripts as strings in the bundle.

### Runtime
`bunfig.toml` configures bun's runtime to load `.lua` files as text (matching tsup's build behavior). This is required for both `bun test` and `bun run dev`.

### Test
```bash
bun test              # Run all tests
bun test tests/       # Run all tests (explicit path)
bun test --watch      # Watch mode
```

**Test infrastructure:**
- Uses bun's built-in test runner (`bun:test`)
- In-memory BetterAuth instance (no database needed) via `betterAuth()` with no database config
- Redis tests use `ioredis-mock` injected via `mock.module("ioredis", ...)` — no real Redis needed
- Auth is handled via `bearer()` plugin + cookie-based session from `signIn.email()`
- Each test file creates its own isolated BetterAuth instance

**Test helper** (`tests/test-helper.ts`) provides:
- `createTestInstance(opts?)` — creates BetterAuth + usage plugin with in-memory DB
- `signInWithTestUser(instance)` — signs in and returns session cookie headers
- `createCustomer(instance, headers, referenceId)` — upserts a customer (required before consuming)

---

## WIP / Known Gaps

- `featureLimits` on the customer schema is commented out — per-customer limit overrides aren't wired yet
- `authorizeReference` in the WebSocket server has a TODO for `incomingId` handling
- `set-limit.lua` is an empty placeholder
- Debug `console.log` statements are still scattered through resolvers and cache code
- The usage and customer middlewares are defined but commented out in all endpoints that use them
- `getUsageOptions()` re-initializes cache/tracker/WebSocket on every request (no singleton/caching of the infrastructure objects)
- `GET /usage/features/{featureKey}` has a `body` schema on a GET request which doesn't work with standard clients
- The consume endpoint writes `event: "usage"` (hardcoded) in the no-cache DB path, but the request body's `event` field (default `"use"`) is used in the cache path — inconsistent event naming
- `customerLimitsSchema` is defined in schema.ts but the corresponding customer limits table doesn't exist in the plugin schema
- The `useCustomer(referenceId)` customer provider hook is on the roadmap but not implemented
