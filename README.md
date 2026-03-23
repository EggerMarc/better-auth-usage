# @eggermarc/better-auth-usage

**Warning!** This package is a **work in progress**! Expect breaking changes and functionality changes.

Usage tracking, feature gating, and billing metering plugin for [BetterAuth](https://www.better-auth.com/). Define features with limits and reset strategies in your config, track usage per customer/team/session, gate access based on plan-specific limits, and stream usage state to clients in real-time.

## Vision

This plugin aims to be the **single source of truth for feature access** in BetterAuth apps. From the config, you define the scopes and how the usage of a feature works. On the UI/UX side, you track whether a user still has access or not.

**Core goals:**
- **Type-safe feature keys** — Features defined in config become a union type. `featureKey: "api-calls"` autocompletes and type-checks everywhere.
- **Entitlement API** — `canUse()` (check-only) and `useFeature()` (atomic check + consume). One call to gate any action.
- **Sub-10ms writes** — Redis-primary with write-ahead log (WAL) for durability. Lua script does atomic increment + reset + WAL append + publish.
- **Real-time state** — Reactive client with websocket subscription, local state, `isAllowed()` sync check, and threshold callbacks. Build your own dashboards.
- **Plan transitions** — When a customer changes plans, usage carries over or resets per feature config. Plan ID recorded on every event for billing reconciliation.
- **Analytics-ready** — Dual-table DB: `usage` (fast reads) + `usage_history` (append-only event log for time-series, billing, and audit).
- **Framework-agnostic client** — Vanilla JS/TS tracker ships in-package. React/Vue/Svelte wrappers are ~15 lines.

## Roadmap

### Completed
- [x] Customer table
- [x] Consumption adapter as transaction
- [x] Redis caching with Lua-based atomic increments
- [x] Real-time WebSocket updates (optional)
- [x] Comprehensive test coverage (284 tests)
- [x] Critical bug fixes (shouldReset, Lua script, operator precedence, falsy checks, double-write)

### v1.0
- [ ] Effect runtime (`effect` + `@effect/schema`, typed errors, service layers)
- [ ] Type-safe feature keys (const generic inference from config)
- [ ] Entitlement endpoints (`/usage/can-use`, `/usage/use-feature`)
- [ ] Dual-table DB (`usage` + `usage_history` with `planId`)
- [ ] Redis-primary + WAL (Redis Streams, background drain worker)
- [ ] Plan transitions (`onPlanChange: "carry-over" | "reset"` per feature)
- [ ] Reactive client (websocket + polling fallback, local state, threshold events)
- [ ] Auto-resolve `overrideKey` from customer
- [ ] Optional customer in consume flow
- [ ] Config validation at init
- [ ] Structured logging (user-provided logger)
- [ ] Auth on all endpoints

### Future
- [ ] Idempotency keys
- [ ] Bulk operations (batch consume, batch check)
- [ ] Manual reset endpoint
- [ ] Usage history query endpoint

## Features

- Define features with maxLimit, minLimit, reset strategies, and metadata.
- Apply plan-specific overrides (e.g. different limits per plan).
- Hook into usage events (before and after).
- Add custom authorization logic with authorizeReference.
- Optional Redis caching with atomic Lua-based increments.
- Optional real-time usage tracking via WebSocket (Socket.IO).

### Installation
```bash
npm add @eggermarc/better-auth-usage
# or
bun add @eggermarc/better-auth-usage
# or
pnpm add @eggermarc/better-auth-usage
```

### Usage
#### Server
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
                details: ["Number of API calls per month"],
            },
            "credits": {
                key: "credits",
                maxLimit: 50000,
                reset: "never",
            }
        },
        overrides: {
            "starter-plan": {
                features: {
                    "api-calls": { maxLimit: 10_000 },
                },
            },
            "pro-plan": {
                features: {
                    "api-calls": { maxLimit: 1_000_000 },
                    "credits": { maxLimit: 500_000 },
                },
            },
        },
        // Optional: enable Redis caching
        // cacheOptions: {
        //     redisUrl: process.env.REDIS_URL!,
        //     enableRealtime: true,  // optional WebSocket support
        //     port: 3001,            // required if enableRealtime is true
        // },
    })]
})
```

#### Client
```ts
import { createAuthClient } from "better-auth/client";
import { usageClient } from "@eggermarc/better-auth-usage/client";

export const client = createAuthClient({
  plugins: [usageClient()],
});
```

### Customer Registration

**Important:** A customer must be registered before consuming usage. The consume endpoint requires the customer to exist.

```ts
// Register a customer (user, team, org, session — you define the scope)
await client.usage.upsertCustomer({
  referenceId: "team-123",
  referenceType: "team",
  name: "Acme Corp",
  overrideKey: "pro-plan",  // auto-resolved on consume/check
});

// Consume usage
await client.usage.consume({
  featureKey: "api-calls",
  referenceId: "team-123",
  amount: 1,
});

// Check current usage and limits
const status = await client.usage.check({
  featureKey: "api-calls",
  referenceId: "team-123",
});
// => { status: "in-limit", currentAmount: 1, maxLimit: 1000000, remaining: 999999, percent: 0 }
```

### Design Philosophy

Why customer registration and not per user / organization query?

We don't make assumptions about the origin of the customer. By giving customer registration to the developer, we allow multiple scenarios:

- **Per-user** — `referenceId: userId`
- **Per-team** — `referenceId: teamId`, shared usage across team members
- **Per-organization** — `referenceId: orgId`
- **Per-session / per-IP** — `referenceId: session.ipAddress`, rate limiting
- **Per-API-key** — `referenceId: apiKeyId`

#### Examples
##### Team based
```ts
await client.usage.upsertCustomer({
    referenceId: teamId,
    referenceType: "team",
    name: `${session.user.name}@${teamName}`,
    overrideKey: "team-plan",
})

await client.usage.consume({
    featureKey: "api-calls",
    referenceId: teamId,
    amount: 1,
})
```
##### Session based / IP based
```ts
const referenceId = session.session.ipAddress ?? session.session.id;

await client.usage.upsertCustomer({
    referenceId,
    referenceType: "session",
})

await client.usage.consume({
    featureKey: "api-calls",
    referenceId,
    amount: 1,
})
```

### API Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/usage/features` | GET | none | List all registered features |
| `/usage/features/{featureKey}` | GET | none | Get a single feature config (with optional override) |
| `/usage/consume` | POST | session | Consume/increment usage for a feature |
| `/usage/check` | POST | session | Check current usage vs limits (with optional preview amount) |
| `/usage/check-customer` | POST | session | Get customer details by referenceId |
| `/usage/upsert-customer` | POST | session | Create or update a customer |
| `/usage/sync` | POST | none | Manually trigger reset if due |

### Override Structure

Overrides require a nested `features` key:

```ts
overrides: {
    "plan-name": {
        features: {                    // <-- required
            "feature-key": {
                maxLimit: 10_000,      // overrides the base feature's maxLimit
                // any Feature field except `key` can be overridden
            },
        },
    },
}
```

The `overrideKey` is passed per-request to `consume`, `check`, or `sync` endpoints to apply the override for that specific call. If a customer has an `overrideKey` set, it will be auto-resolved (v1.0).

### Reset Strategies

Features can specify a `reset` interval to automatically zero out usage:

| Reset | Boundary |
|-------|----------|
| `"hourly"` | Start of next hour |
| `"6-hourly"` | Next 6-hour block (00:00, 06:00, 12:00, 18:00) |
| `"daily"` | Tomorrow at 00:00 |
| `"weekly"` | Next Monday at 00:00 |
| `"monthly"` | 1st of next month at 00:00 |
| `"quarterly"` | 1st of next quarter at 00:00 |
| `"yearly"` | January 1st of next year at 00:00 |
| `"never"` | Never resets |
