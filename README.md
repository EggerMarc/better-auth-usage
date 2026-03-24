# @eggermarc/better-auth-usage

**Warning!** This package is a **work in progress**! Expect breaking changes and functionality changes.

Usage tracking, feature gating, and billing metering plugin for [BetterAuth](https://www.better-auth.com/). Define features with limits and reset strategies in your config, track usage per customer/team/session, gate access based on plan-specific limits, and stream usage state to clients in real-time.

## Architecture

```
Client Request → BetterAuth Endpoint → Effect Pipeline → Redis (Lua, <10ms)
                                                       ↓
                                              WAL Stream (XADD)
                                                       ↓
                                              WAL Worker (subscribe/poll)
                                                       ↓
                                              DB: usage (current) + usage_event (history)
```

- **Redis-primary**: Atomic Lua script handles increment, reset check, WAL append, and pub/sub in a single `EVAL`
- **WAL durability**: Redis Stream acts as a write-ahead log, drained to DB by a background worker
- **DB fallback**: Works without Redis (DB-only mode) — just slower
- **Effect runtime**: All server-side logic uses [Effect](https://effect.website/) for typed errors, composable pipelines, and structured concurrency

## Installation

```bash
bun add @eggermarc/better-auth-usage
# or
npm add @eggermarc/better-auth-usage
```

## Quick Start

### Server

```typescript
import { betterAuth } from "better-auth";
import { usage } from "@eggermarc/better-auth-usage";

export const auth = betterAuth({
    plugins: [usage({
        features: {
            "api-calls": {
                key: "api-calls",
                maxLimit: 1000,
                reset: "monthly",
                resetValue: 0,
            },
            "credits": {
                key: "credits",
                maxLimit: 50000,
                reset: "never",
                onPlanChange: "reset", // reset credits when plan changes
            },
        },
        overrides: {
            "starter": {
                features: {
                    "api-calls": { maxLimit: 1_000 },
                },
            },
            "pro": {
                features: {
                    "api-calls": { maxLimit: 100_000 },
                    "credits": { maxLimit: 500_000 },
                },
            },
        },
        // Optional: Redis for sub-10ms writes + WAL durability
        cacheOptions: {
            redisUrl: process.env.REDIS_URL!,
            wal: {
                enabled: true,
                drainStrategy: "subscribe", // zero idle cost (default)
                // drainStrategy: "poll",   // use if pub/sub unavailable
                // pollInterval: 1000,      // ms, only for "poll"
            },
        },
        // Optional: custom logger (default: console)
        // logger: { debug: ..., info: ..., warn: ..., error: ... },
    })]
})
```

### Client

```ts
import { createAuthClient } from "better-auth/client";
import { usageClient } from "@eggermarc/better-auth-usage/client";

export const client = createAuthClient({
    plugins: [usageClient()],
});
```

## API

### Consume usage

```ts
await client.usage.consume({
    featureKey: "api-calls",
    referenceId: "team-123",
    amount: 1,
});
```

### Check usage (read-only)

```ts
const res = await client.usage.check({
    featureKey: "api-calls",
    referenceId: "team-123",
});
// res.data => { current: 42, max: 1000, remaining: 958, percent: 4, status: "in-limit", allowed: true }
```

### Entitlement check (can I use this?)

```ts
const res = await client.usage.canUse({
    featureKey: "api-calls",
    referenceId: "team-123",
    amount: 1, // optional, defaults to 1
});
// res.data => { allowed: true, status: "in-limit", remaining: 958 }
```

### Atomic check + consume

```ts
const res = await client.usage.useFeature({
    featureKey: "api-calls",
    referenceId: "team-123",
    amount: 1,
});
// res.data => { allowed: true, current: 43, ... } — only consumes if allowed
```

### Customer registration

```ts
await client.usage.upsertCustomer({
    referenceId: "team-123",
    referenceType: "team",
    name: "Acme Corp",
    overrideKey: "pro", // auto-resolved on consume/check when not passed explicitly
});
```

## Reactive Client

Track usage in real-time from the browser. Ships as part of the `/client` export.

```ts
import { createUsageTracker } from "@eggermarc/better-auth-usage/client";

const tracker = createUsageTracker({
    baseURL: "/api/auth",
    websocket: false,      // true for Socket.IO, false for polling
    pollInterval: 3000,    // ms, only when websocket is false
    thresholds: [0.5, 0.8, 0.9, 1.0],
});

const handle = tracker.track({
    referenceId: "team-123",
    features: ["api-calls", "credits"],
});

// Sync reads — zero latency, reads from local state
handle.isAllowed("api-calls")  // true
handle.getUsage("api-calls")   // { current, max, remaining, percent, status, allowed }

// Events
handle.on("update", (state) => { /* all features updated */ });
handle.on("threshold", (e) => { /* e.feature crossed e.threshold */ });
handle.on("blocked", (e) => { /* e.feature is now over limit */ });

// Cleanup
handle.dispose();
```

Framework wrappers are trivial — a React hook is ~15 lines:

```tsx
function useUsage(referenceId: string, features: string[]) {
    const [state, setState] = useState({});
    useEffect(() => {
        const tracker = createUsageTracker({ baseURL: "/api/auth", pollInterval: 3000 });
        const handle = tracker.track({ referenceId, features });
        handle.on("update", setState);
        return () => handle.dispose();
    }, [referenceId]);
    return state;
}
```

## Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/usage/consume` | POST | session | Consume/increment usage |
| `/usage/check` | POST | session | Check current usage vs limits |
| `/usage/can-use` | POST | session | Entitlement check (read-only) |
| `/usage/use-feature` | POST | session | Atomic check + consume |
| `/usage/upsert-customer` | POST | session | Create or update a customer |
| `/usage/check-customer` | POST | session | Get customer by referenceId |
| `/usage/features` | GET | session | List all features |
| `/usage/features/:key` | GET | session | Get single feature config |
| `/usage/sync` | POST | session | Manually trigger reset if due |

## Customer Model

We don't assume who the customer is. You define the scope:

| Scope | referenceId | referenceType |
|-------|------------|---------------|
| Per-user | `userId` | `"user"` |
| Per-team | `teamId` | `"team"` |
| Per-org | `orgId` | `"org"` |
| Per-session | `session.id` | `"session"` |
| Per-IP | `request.ip` | `"ip"` |

Set `overrideKey` on the customer to auto-resolve plan overrides on every consume/check.

## Plan Transitions

When a customer's `overrideKey` changes, each feature handles the transition independently:

```ts
features: {
    "api-calls": {
        key: "api-calls",
        maxLimit: 100,
        onPlanChange: "carry-over", // default — usage stays, limits change
    },
    "credits": {
        key: "credits",
        maxLimit: 1000,
        onPlanChange: "reset",      // usage resets to resetValue on plan change
    },
}
```

Plan changes are logged to `usage_event` with `event: "plan-change"` and the new `overrideKey` for billing reconciliation.

## Reset Strategies

All reset boundaries are computed in **UTC**.

| Reset | Boundary |
|-------|----------|
| `"hourly"` | Start of next UTC hour |
| `"6-hourly"` | Next 6-hour block (00:00, 06:00, 12:00, 18:00 UTC) |
| `"daily"` | Tomorrow at 00:00 UTC |
| `"weekly"` | Next Monday at 00:00 UTC |
| `"monthly"` | 1st of next month at 00:00 UTC |
| `"quarterly"` | 1st of next quarter at 00:00 UTC |
| `"yearly"` | January 1st of next year at 00:00 UTC |
| `"never"` | Never resets |

## Redis Configuration

Redis is optional. Without it, the plugin works in DB-only mode (slower but functional).

With Redis, the plugin uses:
- **Lua scripts** for atomic increment + reset check (<1ms)
- **Redis Streams** as a WAL for durable DB sync
- **Pub/sub** for real-time event broadcasting

```ts
cacheOptions: {
    redisUrl: "redis://localhost:6379",
    wal: {
        enabled: true,              // default
        drainStrategy: "subscribe", // default — zero idle cost via pub/sub
        // drainStrategy: "poll",   // alternative — polls every pollInterval
        // pollInterval: 1000,      // ms, only for "poll" strategy
    },
}
```

**Important:** Redis must allow `EVAL`, `XADD`, `PUBLISH`, `SET`, `GET`, `HSET`, `HGETALL` commands. Managed Redis services with restricted ACLs (e.g. Upstash free tier) may not support the Lua script path — the plugin will fall back to DB-only mode silently.

## DB Schema

The plugin registers two tables via BetterAuth's schema system:

**`usage`** — one row per (referenceId, feature), fast reads:
- `referenceId`, `feature`, `amount` (current total), `event`, `lastResetAt`, `createdAt`, `updatedAt`

**`usage_event`** — append-only event log for analytics/billing:
- `referenceId`, `feature`, `amount` (delta), `event`, `overrideKey`, `lastResetAt`, `createdAt`

## Running the Example

```bash
# Start local Redis
docker compose up -d

# Build the plugin
bun run build

# Run the Next.js example
cd examples/nextjs
bun install
bun run dev
```

## Development

```bash
bun run build              # Build the plugin
bun run test               # 136 tests (no Docker needed)
bun run test:redis         # 11 Redis integration tests (needs: docker compose up -d)
bun run test:perf          # Performance benchmarks
```
