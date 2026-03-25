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
- [x] Config validation at init — `package/config.ts` (moved to Phase 8)

Note: Zod remains a dependency — BetterAuth's `createAuthEndpoint` requires Zod for body validation.

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

## Phase 8: Config Validation + Performance — DONE

- [x] `package/config.ts` — validates at init: features non-empty, key matches, maxLimit >= minLimit, finite numbers, override references valid features, cache/wal config coherent
- [x] `validateAmount` in consume pipeline — rejects `Infinity`, `NaN`, non-finite numbers via `ValidationError`
- [x] `ValidationError` mapped to `BAD_REQUEST` in `runPipeline`
- [x] Performance benchmark tests: consume avg 2.3ms, check avg 1.4ms, can-use avg 0.9ms (DB-only)

## Phase 9: Tests — DONE

- [x] `tests/entitlements.test.ts` — 6 tests: can-use (allowed, denied, preview) + use-feature (consume, reject, default amount)
- [x] `tests/validation.test.ts` — 6 tests: config validation (empty features, maxLimit < minLimit, unknown override ref) + amount validation (Infinity, NaN)
- [x] `tests/plan-transitions.test.ts` — 4 tests: carry-over on upgrade, reset on plan change, event logging, auto-resolve overrideKey
- [x] `tests/performance-comparison.test.ts` — 5 tests: sequential throughput (1,075 ops/sec), burst (50 parallel), check after 200 writes, mixed workload, multi-feature
- [x] `tests/performance.test.ts` — 4 tests: consume/check/can-use latency, burst correctness
- [x] Fixed: `overrideKey` field added to `customer` BetterAuth schema (was missing)

## Phase 10: Hardening — priority order

### P0 — Runtime bugs — DONE
- [x] **Realtime `get:usage` fixed** — `setupWebSocketHandlers` now accepts a `layer` parameter and provides it to `checkUsage` via `Effect.provide(layer)`.

### P1 — Silent data corruption — DONE
- [x] **`shouldReset` uses UTC** — all `getDay`/`setHours`/etc. replaced with UTC variants. Tests updated.

### P2 — Type safety — PARTIALLY DONE
- [x] **Zero `as any` casts** — redis.ts uses `client.call()` typed interface, pipelines use `Record<string, unknown>`, features endpoint uses destructuring instead of delete
- [ ] **Feature key inference doesn't reach client** — `usageClient()` has no generic, so `client.usage.check({ featureKey: "..." })` has no autocomplete. Wire `InferFeatureKeys<O>` through `$InferServerPlugin`.

### P3 — Testability
- [ ] **WAL worker 9% coverage in default suite** — drain logic, coalescing, XACK entirely untested without real Redis. Fix: create in-memory stream mock for `RedisService` that supports XADD/XREADGROUP, test drain logic in `bun run test`.

### P4 — Architecture
- [ ] **runtime.ts global mutable state** — 4 module-level `let` variables (`sharedLayer`, `capturedAdapter`, `walFiber`, `walStarted`). Fix: replace with Effect `ManagedRuntime` for proper lifecycle.
- [ ] **consume.ts is 303 lines** — 5 concerns in one file. Split into `consume.ts`, `use-feature.ts`, `helpers/write-to-db.ts`, `helpers/lift-callback.ts`.

### P5 — Resilience
- [ ] **Plan transitions aren't atomic** — `handleFeaturePlanChange` runs features concurrently. Process crash mid-way = partial plan change. Fix: wrap in DB transaction via `adapter.transaction`.
- [ ] **No max amount protection** — `consume({ amount: Number.MAX_SAFE_INTEGER })` is valid. Add `maxAmount` config per feature or global cap.

### P6 — DX
- [ ] **BetterAuth schema fields not type-checked** — `overrideKey` was missing from DB schema but present in TypeScript type. No compile-time detection. Fix: build-time assertion that type keys match schema fields.
- [ ] **Zod + @effect/schema coexist** — can't remove Zod (BetterAuth requires it). Document it.
- [ ] **No idempotency keys** — retry = double-count. Add optional `idempotencyKey` on consume.

---

## Phase 11: WebSocket First-Class Transport + Auth

Full technical plan: `.claude/plans/fancy-cooking-sparkle.md`

### 11a. Auth Infrastructure
- [ ] Add `authorizeUser` callback to `UsageOptions` — global auth: `({ userId, referenceId, referenceType, feature }) => boolean`. Replaces per-feature `authorizeReference`.
- [ ] Remove `authorizeReference` from `Feature` type
- [ ] Create `realtime/auth.ts` — token validation via BetterAuth session lookup (accepts session token or bearer token)
- [ ] WS handshake auth middleware — validates token in `socket.handshake.auth.token`, attaches `socket.data.userId`
- [ ] Update REST endpoints to call `authorizeUser` with `session.user.id` before running pipelines

### 11b. Full WS API
- [ ] Rewrite `websocket-server.ts` — full operation handlers: `check`, `can-use`, `consume`, `use-feature` (reuse existing Effect pipelines)
- [ ] WS request-response pattern: client emits `check` → server emits `check:result`
- [ ] All mutations (REST or WS) broadcast `usage:updated` to subscribed WS rooms (Lua pub/sub handles Redis path; direct `io.to(room).emit()` for non-Redis/belt-and-suspenders)
- [ ] Error mapping on WS matches `runPipeline` error mapping
- [ ] Pass auth context to WS server setup in `runtime.ts`

### 11c. Client WS Transport + Reconnection Fix
- [ ] Fix WS reconnection: on `connect` event stop polling fallback, re-subscribe to rooms
- [ ] Add explicit Socket.IO reconnection config (`reconnection: true`, exponential backoff)
- [ ] Auth token in `socket.handshake.auth.token`
- [ ] Client operations (consume, check, canUse, useFeature) route through WS when connected, fall back to REST
- [ ] Immutable state (new object ref on update) for `useSyncExternalStore` compat
- [ ] Add public `subscribe(cb)` and `getSnapshot()` methods to `UsageTrackerHandle`

## Phase 12: Framework Clients

### 12a. React Hooks — `@eggermarc/better-auth-usage/react`
- [ ] `UsageProvider` — creates tracker with config + auth token, handle cache with refCounting, SSR-safe
- [ ] `useUsage({ referenceId, features })` — `useSyncExternalStore` for zero-tearing reads
- [ ] `useFeatureUsage(feature, referenceId)` — single-feature convenience hook
- [ ] `useUsageActions(referenceId)` — returns bound `consume`, `check`, `canUse`, `useFeature` functions (WS or REST)
- [ ] `useUsageEvent("threshold" | "blocked", handler)` — stable handler ref via `useRef`
- [ ] Build config: `react` entry in `tsup.config.ts`, `./react` export in `package.json`, `react ^18 || ^19` optional peer dep
- [ ] Update `examples/nextjs/src/app/page.tsx` to use hooks

### 12b. Vue Composables — `@eggermarc/better-auth-usage/vue`
- [ ] `useUsage`, `useFeatureUsage`, `useUsageActions`, `useUsageEvent` as Vue composables
- [ ] Uses `ref()` / `watchEffect()` with `subscribe()`/`getSnapshot()`

### 12c. Svelte Stores — `@eggermarc/better-auth-usage/svelte`
- [ ] Svelte store adapters wrapping `subscribe()`/`getSnapshot()`

### 12d. Solid Signals — `@eggermarc/better-auth-usage/solid`
- [ ] `createStore`-based integration

### 12e. Angular Service — `@eggermarc/better-auth-usage/angular`
- [ ] Injectable service with RxJS Observable wrappers

---

# Test Commands

```bash
bun run test          # 128 tests — e2e + unit (no Docker needed)
bun run test:redis    # 11 tests — Redis integration (requires: docker run -d -p 6399:6379 redis:7-alpine)
bun run test:perf     # 9 tests — performance benchmarks with [PERF] output
```

Note: `bun run test:redis` requires a running Redis on port 6399. These tests verify Lua script execution, WAL stream (XADD/XREADGROUP/XACK), pub/sub publishing, and concurrent writes (100 parallel increments). They are excluded from the default `bun run test` to avoid ioredis-mock conflicts.

---

# Current State: 128 tests, 0 failures, 14 test files (+ 11 infra tests)

## File Structure
```
package/
├── index.ts              Plugin factory (const generic, satisfies)
├── types.ts              Clean types, InferFeatureKeys/InferOverrideKeys
├── schema.ts             Pure @effect/schema
├── errors.ts             7 typed Effect errors
├── config.ts             Config validation at init
├── runtime.ts            runPipeline + WAL init + centralized error mapping
├── utils.ts              checkLimit, shouldReset, redactId
├── client.ts             BetterAuth client + reactive tracker (createUsageTracker)
├── react.ts              React hooks (UsageProvider, useUsage, useFeatureUsage, useUsageActions, useUsageEvent)
├── services/             RedisService, DbService, LoggerService
├── pipelines/            All business logic (Effect)
├── endpoints/            9 endpoints (thin wrappers, zero try-catch)
├── wal/                  WAL worker + recovery
├── adapters/lua/         increment.lua, set-meta.lua
└── realtime/             Auth, pure subscriber, full WS API handlers (Effect)
```
