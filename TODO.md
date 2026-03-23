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
- [ ] `@effect/schema` schemas replacing Zod
- [ ] Config validation at init

## Phase 3: Dual-Table DB + Lua Rewrite
- [ ] `usage` table — one row per (referenceId, feature), fast reads
- [ ] `usage_history` table — append-only event log with `planId` for analytics/billing
- [ ] `get-usage` pipeline → `findOne` on `usage` table (currently still uses findMany + reduce)
- [ ] New queries: `upsert-usage.ts`, `insert-history.ts`
- [ ] Lua `increment.lua` → add XADD for WAL stream + PUBLISH for realtime
- [ ] `set-meta.lua` — set metadata hash with epoch_ms
- [ ] Delete remaining old query files (`get-usage.ts`, `insert-usage.ts`)
- [ ] Migration guide for existing users

## Phase 4: WAL Worker
- [ ] `wal/worker.ts` — `Effect.repeat` + `Schedule.spaced(1s)`, XREADGROUP consumer group
- [ ] `wal/recovery.ts` — startup XAUTOCLAIM of pending entries
- [ ] Drain: INSERT each event into `usage_history`, coalesce + UPSERT `usage`, XACK
- [ ] Backpressure: XLEN check, warn via LoggerService
- [ ] Graceful shutdown: `Fiber.interrupt`, await final drain

## Phase 5: Plan Transitions
- [ ] Detect `overrideKey` change in `upsertCustomer`
- [ ] Per-feature `onPlanChange: "carry-over" | "reset"` config (default: carry-over)
- [ ] Record `planId` on WAL entries and `usage_history`
- [ ] Broadcast new limits via realtime on plan change

## Phase 6: Reactive Client
- [ ] Vanilla JS/TS tracker in `@eggermarc/better-auth-usage/client`
- [ ] Socket.IO subscription + polling fallback
- [ ] Local state: `isAllowed()`, `getUsage()`, `getAll()` — sync, zero latency
- [ ] Events: `on("update")`, `on("threshold")`, `on("blocked")`
- [ ] Configurable thresholds (e.g. `[0.5, 0.8, 0.9, 1.0]`)
- [ ] Type-safe feature keys from server config
- [ ] `dispose()` lifecycle cleanup

## Phase 7: Polish + Tests
- [ ] Structured logging via LoggerService (replace remaining console.log calls)
- [ ] Delete remaining legacy code (`tryCatch`, old adapters/index.ts, cache.ts tryCatch usage)
- [ ] Rewrite realtime (usage-tracker, websocket-server) to use Effect services
- [ ] Rewrite tests with Effect test layers
- [ ] Integration tests: WAL drain, reset boundary, realtime, plan transitions
- [ ] Performance test: sub-10ms write latency
- [ ] Concurrent consume race condition tests

---

# Current State: 153 tests, 0 failures, 11 test files

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

| Bug | Phase |
|-----|-------|
| Fire-and-forget DB write when cache enabled | Phase 4 (WAL replaces it) |
| DB queries fetch all rows then sum in JS | Phase 3 (findOne on usage table) |
| Schema shape mismatch in cache.insertEvent | Phase 3 (single schema) |
| Silent `.catch()` in legacy cache/realtime | Phase 7 (rewrite to Effect) |
| No input validation on `amount` | Phase 1 (@effect/schema, still TODO) |
| No config validation at init | Phase 1 (@effect/schema, still TODO) |
| No Redis key sanitization | Phase 3 |
| Reset timezone sensitivity (local Date methods) | Phase 3 (UTC epoch_ms) |
| No idempotency keys | Future |
| Debug logs with `\n\n\n` in legacy cache code | Phase 7 |
