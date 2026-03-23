# Product Plan: v1.0 Rewrite

Full technical plan: `.claude/plans/optimized-moseying-brooks.md`

## Phase 1-2: Effect Foundation + Core Pipelines — DONE

- [x] Add `effect` and `@effect/schema` dependencies
- [x] `const` generic on `usage()` factory — `satisfies BetterAuthPlugin` (DTS 4.5KB → 35KB)
- [x] `InferFeatureKeys<O>` and `InferOverrideKeys<O>` type utilities exported
- [x] Effect services: `RedisService`, `DbService`, `LoggerService` (as Layers)
- [x] Typed errors: `FeatureNotFound`, `CustomerNotFound`, `RedisError`, `DbError`, `LimitExceeded`, `ValidationError`, `PlanChangeError`
- [x] `runtime.ts` — `runPipeline()` bridge (BetterAuth → Effect)
- [x] All 7 pipelines: `features`, `get-usage`, `get-customer`, `consume`, `check`, `customer`, `sync`
- [x] All endpoints rewired through Effect (`endpoints/v2/`)
- [x] New endpoints: `/usage/can-use` + `/usage/use-feature`
- [x] Auto-resolve `overrideKey` from customer via `resolveOverrideKey` pipeline
- [x] Optional customer in consume flow (`getCustomerOptional`)
- [x] Auth (sessionMiddleware) on all endpoints
- [x] Hooks via `Promise.resolve()` lift — clean, no try-catch
- [x] Old code cleanup: deleted resolvers/, old endpoints, middlewares/, set-limit.lua, normalizeData
- [x] `tryCatch` marked `@deprecated`, kept only for legacy cache/realtime code
- [x] `@effect/schema` schemas replacing Zod (`UsageSchema`, `CustomerSchema`, `UsageEventSchema`, `CachedUsageSchema`, `CachedLimitsSchema`, `CachedUsageEventSchema`)
- [x] `types.ts` — `z.infer<>` replaced with `Schema.Schema.Type<>`
- [x] Schema tests rewritten with `Schema.decodeUnknownEither`
- [x] Lua `cjson`/`XADD` guarded for mock Redis compatibility
- [ ] Config validation at init (can use `@effect/schema` for this now)

Note: Zod remains a dependency — BetterAuth's `createAuthEndpoint` requires Zod for body validation. Legacy Zod schemas kept (deprecated) for `cache.ts` and `usage-tracker.ts`.

## Phase 3: Dual-Table DB + Lua Rewrite — DONE

- [x] `usage` table — one row per (referenceId, feature), `updatedAt` field added
- [x] `usageEvent` table — append-only event log with `overrideKey` for analytics/billing
- [x] `get-usage` pipeline → `findOne` on `usage` table (O(1) reads)
- [x] Consume pipeline → upsert `usage` (total) + insert `usageEvent` (delta)
- [x] Lua `increment.lua` → XADD to `wal:usage` stream + PUBLISH to `usage:events:*`
- [x] `set-meta.lua` — set metadata hash with epoch_ms
- [x] `cache.ts` updated to pass 3 KEYS + 5 ARGV to Lua

## Phase 4: WAL Worker — DONE

- [x] Stream ops added to `RedisService` (`xreadgroup`, `xack`, `xgroupCreate`, `xlen`, `xtrim`, `psubscribe`)
- [x] `wal/worker.ts` — drain logic, coalescing, subscribe + poll strategies
- [x] `wal/recovery.ts` — startup XAUTOCLAIM of pending entries
- [x] Two configurable strategies:
  - `"subscribe"` (default) — zero idle cost, push-based via pub/sub
  - `"poll"` — `Effect.repeat` + `Schedule.spaced`, ⚠️ ~4 cmds/sec idle
- [x] WAL config in `UsageOptions`: `cacheOptions.wal.{ enabled, drainStrategy, pollInterval }`
- [x] Runtime starts WAL worker on first request, captures adapter
- [x] Consume pipeline skips direct DB writes when WAL is active
- [x] Backpressure: XLEN check, warn via LoggerService
- [x] Graceful shutdown: `Fiber.interrupt` in `resetRuntime()`

## Phase 5: Plan Transitions — DONE

- [x] `onPlanChange: "carry-over" | "reset"` added to `Feature` type (default: carry-over)
- [x] `upsertCustomer` detects `overrideKey` change (old vs new)
- [x] Per-feature handling: carry-over (keep counter, log event) or reset (reset counter + DB + Redis, log event)
- [x] `plan-change` events logged to `usageEvent` table with `overrideKey`
- [x] Endpoint passes `features` config to pipeline for feature iteration

## Phase 6: Reactive Client — DONE

- [x] `createUsageTracker(options)` factory + `UsageTrackerHandle` class
- [x] `isAllowed(feature)`, `getUsage(feature)`, `getAll()` — sync, zero latency
- [x] `on("update")`, `on("threshold")`, `on("blocked")` + `off()` for unsubscribe
- [x] Configurable thresholds with crossed/reset tracking
- [x] WebSocket via `socket.io-client` (auto-subscribe to rooms, refetch on events)
- [x] Polling fallback (if websocket fails or `websocket: false`)
- [x] `dispose()` — cleanup socket, timers, handlers
- [x] Custom `fetchImpl` and `headers` options (SSR, testing, auth cookies)
- [x] `satisfies BetterAuthClientPlugin` (preserves type info, DTS 143B → 4.39KB)
- [x] New endpoints in pathMethods: `/usage/can-use`, `/usage/use-feature`
- [x] `socket.io-client` added as dependency

## Phase 7: Polish — DONE

- [x] Centralized error mapping in `runPipeline` — all endpoints stripped of try-catch
- [x] Endpoint code reduced from ~50 to ~30 lines each
- [x] WAL worker: event inserts + upserts run concurrently (`Effect.all`, unbounded)
- [x] Plan change: all features processed concurrently (`Effect.all`, unbounded)
- [x] Plan change reset: Redis + DB run concurrently (`Effect.all`, concurrency: 2)
- [x] Extracted `handleFeaturePlanChange` and `upsertUsageRow` helpers
- [x] All try-catch and .catch patterns replaced with Effect (`liftCallback`, `Effect.andThen`, `Effect.catchAll`)
- [x] `liftCallback` / `liftAuthorize` helpers for user-provided sync/async callbacks
- [x] Realtime rewritten to use Effect services (pure subscriber, `Effect.try` + `andThen`)
- [x] WebSocket server uses `checkUsage` pipeline instead of legacy `tracker.getUsage`
- [x] Deleted all legacy code: `cache.ts`, `adapters/index.ts`, `adapters/queries/`, `resolvers/`, realtime tests
- [x] Deleted `tryCatch`, `normalizeData`, deprecated Zod schemas, `cached_*` types
- [x] Flattened `endpoints/v2/` → `endpoints/`
- [x] Zero `console.log` in source code (only in `LoggerService` default implementation)
- [x] Zero try-catch in server code (only `Promise.resolve` bridge for user callbacks)
- [x] BUSYGROUP handling via `Effect.catchAll` pattern match instead of `.catch`

## Phase 8: Remaining

- [ ] Config validation at init (`@effect/schema` — features non-empty, maxLimit >= minLimit, etc.)
- [ ] Tests: rewrite for new architecture (pipelines, WAL, realtime, plan transitions)
- [ ] Performance test: sub-10ms write latency benchmark
- [ ] Concurrent consume race condition tests

---

# Current State: 82 tests, 0 failures, 8 test files

## What's Active
```
package/
├── index.ts                     Plugin factory (const generic, satisfies BetterAuthPlugin)
├── types.ts                     Types + InferFeatureKeys/InferOverrideKeys
├── schema.ts                    Zod schemas (to be replaced by @effect/schema)
├── utils.ts                     checkLimit, shouldReset, computePreviousResetTime, redactId
├── errors.ts                    7 typed Effect errors
├── runtime.ts                   runPipeline() bridge + resetRuntime()
├── client.ts                    BetterAuth client plugin
├── services/                    RedisService, DbService, LoggerService
├── pipelines/                   All business logic as Effect pipelines
├── endpoints/v2/                All endpoints (9 total, 2 new)
├── adapters/
│   ├── index.ts                 Legacy adapter (used by cache.ts only)
│   ├── cache.ts                 UsageCache (legacy, uses tryCatch)
│   ├── lua/increment.lua        Fixed Lua script (epoch_ms)
│   └── queries/                 Legacy query files (used by adapter only)
└── realtime/                    UsageTracker + WebSocketServer (legacy, to be rewritten)
```

## What Was Deleted
- `resolvers/` — 7 files + 3 test files (replaced by pipelines/)
- `endpoints/*.ts` — 8 old endpoint files (replaced by endpoints/v2/)
- `middlewares/` — 2 commented-out files
- `adapters/lua/set-limit.lua` — empty file
- `adapters/queries/__tests__/` — 3 old query test files
- `adapters/__tests__/index.test.ts` — old adapter test
- `normalizeData()` — removed from utils
- 131 unit tests that tested deleted code

---

# Completed Fixes

## Foundational Bug Fixes (7/7)
- [x] `shouldReset()` always returns true → `computePreviousResetTime()`
- [x] `normalizeData()` reads nonexistent `updatedAt` → deleted entirely
- [x] Operator precedence `?? 0 - x` → `(?? 0) - x`
- [x] Falsy checks `resetValue: 0`, `curr: 0` → `== null` / `!= null`
- [x] Lua `tonumber()` on ISO string → epoch_ms
- [x] Lua `newAmount` before reset → compute after reset
- [x] Double-write in pub/sub → removed `cache.insertEvent()` from pmessage handler
- [x] `checkLimit` truthy check → `!= null`

---

# Remaining Known Bugs

| Bug | Status |
|-----|--------|
| ~~Fire-and-forget DB write when cache enabled~~ | **Fixed** — WAL worker handles DB writes |
| ~~DB queries fetch all rows then sum in JS~~ | **Fixed** — `findOne` on `usage` table |
| Silent `.catch()` in legacy cache/realtime | Phase 7 (rewrite to Effect) |
| No input validation on `amount` | Phase 1 leftover (@effect/schema) |
| No config validation at init | Phase 1 leftover (@effect/schema) |
| No Redis key sanitization | Phase 7 |
| Reset timezone sensitivity (local Date methods) | Phase 7 (UTC epoch_ms in Lua, but utils still uses local Date) |
| No idempotency keys | Future |
| Debug logs with `\n\n\n` in legacy cache code | Phase 7 |
