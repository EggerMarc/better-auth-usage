# Product Plan: v1.0 Rewrite

Full technical plan: `.claude/plans/optimized-moseying-brooks.md`

## Phase 1: Type Foundation + Effect Setup
- [ ] Add `effect` and `@effect/schema` dependencies, remove `zod`
- [ ] `const` generic on `usage()` factory — capture feature keys as union type
- [ ] `@effect/schema` schemas: `UsageSnapshot`, `UsageHistory`, `Customer`, `WalEntry`, `Feature`
- [ ] Effect services: `RedisService`, `DbService`, `LoggerService` (as Layers)
- [ ] Typed errors: `FeatureNotFound`, `CustomerNotFound`, `RedisError`, `DbError`, `LimitExceeded`, `ValidationError`
- [ ] `Effect.runPromise()` boundary at each endpoint
- [ ] Config validation at init via `@effect/schema`

## Phase 2: Core Pipelines (replaces resolvers/)
- [ ] `pipelines/consume.ts` — consume + useFeature (atomic check+consume)
- [ ] `pipelines/check.ts` — check + canUse (check-only entitlement)
- [ ] `pipelines/sync.ts` — sync/reset
- [ ] `pipelines/customer.ts` — get/upsert customer + plan transition handling
- [ ] `pipelines/features.ts` — resolveFeature (type-safe, auto-resolve `overrideKey` from customer)
- [ ] Remove `tryCatch()` — replaced by Effect error channel
- [ ] Remove `normalizeData()` — single canonical shape
- [ ] Optional customer in consume (proceed without overrides if not found)

## Phase 3: Dual-Table DB + Lua Rewrite
- [ ] `usage` table — one row per (referenceId, feature), fast reads
- [ ] `usage_history` table — append-only event log with `planId` for analytics/billing
- [ ] `get-usage.ts` → `findOne` on `usage` table (no more findMany + reduce)
- [ ] `upsert-usage.ts` — upsert for `usage` table
- [ ] `insert-history.ts` — append to `usage_history`
- [ ] Rewrite `increment.lua` — atomic: reset → increment → XADD → PUBLISH (epoch_ms)
- [ ] `set-meta.lua` — replaces `set-limit.lua` (epoch_ms)
- [ ] Delete `reset-usage.ts`, `get-latest-usage.ts`
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
- [ ] Auth on all endpoints (currently 3/7 have no session middleware)
- [ ] Structured logging via LoggerService (replace 34 console.log calls)
- [ ] Delete dead code (middlewares/, set-limit.lua, commented featureLimits)
- [ ] Rewrite tests with Effect test layers
- [ ] Integration tests: WAL drain, reset boundary, realtime, plan transitions
- [ ] Performance test: sub-10ms write latency
- [ ] Concurrent consume race condition tests

## New Endpoints (Phase 2)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/usage/can-use` | POST | Check-only entitlement → `{ allowed, current, max, remaining, status }` |
| `/usage/use-feature` | POST | Atomic check + consume → same response, increments if allowed |

---

# Completed Work (v0.1.18)

## Foundational Bug Fixes (7/7 DONE)
- [x] `shouldReset()` always returns true → added `computePreviousResetTime()`, correct boundary check
- [x] `normalizeData()` reads nonexistent `updatedAt` → use `lastResetAt`
- [x] Operator precedence `?? 0 - x` in `sync-usage.ts` → `(?? 0) - x`
- [x] Falsy checks `resetValue: 0`, `curr: 0` in `reset-usage.ts` → `== null` / `!= null`
- [x] Lua `tonumber()` on ISO string → pass epoch_ms (`Date.now()`)
- [x] Lua `newAmount` before reset → compute after reset branch
- [x] Double-write in pub/sub → removed `cache.insertEvent()` from pmessage handler

## Additional Fixes
- [x] `checkLimit` truthy check on `maxLimit`/`minLimit` → `!= null`
- [x] Hardcoded event name on DB-only path → uses `event` parameter
- [x] No initial usage creation path → auto-creates initial record

## Test Coverage (284 tests, 0 failures)

<details>
<summary>Expand test details</summary>

### E2E Tests (69 tests across 6 files)
- Auth enforcement (4), validation errors (3)
- Consume/check pipeline (13), boundary conditions (6)
- Cache-enabled pipeline (11)
- Overrides, hooks, customer management (14)
- Sync/reset logic (5)

### Unit Tests (215 tests across 13 files)
- Schema validation, utility functions, adapter operations
- Cache operations, query functions, resolver logic
- Realtime tracker, websocket server
</details>

---

# Remaining Known Bugs (fixed during rewrite)

| Bug | Phase |
|-----|-------|
| Fire-and-forget DB write when cache enabled | Phase 4 (WAL) |
| Schema shape mismatch: `Usage` spread into `insertEvent` | Phase 2 (single schema) |
| Silent `.catch(() => {})` everywhere (10 instances) | Phase 2 (Effect errors) |
| `resetValue` not used in non-Lua paths | Phase 3 (Lua handles all) |
| No input validation on `amount` (Infinity, NaN) | Phase 1 (@effect/schema) |
| No config validation at init | Phase 1 (@effect/schema) |
| No auth on 3/7 endpoints | Phase 7 |
| No Redis key sanitization | Phase 3 |
| Reset timezone sensitivity (local Date methods) | Phase 3 (UTC epoch_ms) |
| `shouldReset` can loop excessively | Phase 2 (O(1) computePreviousResetTime) |
| DB queries fetch all rows then sum in JS | Phase 3 (findOne on usage table) |
| No connection lifecycle / graceful shutdown | Phase 4 (Effect fibers) |
| No idempotency keys | Future |
| Debug logs with `\n\n\n` in production | Phase 7 |
| Inconsistent logging prefixes | Phase 7 (LoggerService) |
| Dead code (middlewares, set-limit.lua, commented code) | Phase 7 |
