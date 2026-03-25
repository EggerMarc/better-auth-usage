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

### 11a. Auth Infrastructure — DONE
- [x] Add `authorizeUser` callback to `UsageOptions` — global auth: `({ userId, referenceId, referenceType, feature }) => boolean`. Replaces per-feature `authorizeReference`.
- [x] Remove `authorizeReference` from `Feature` type
- [x] Create `realtime/auth.ts` — token validation via BetterAuth `internalAdapter.findSession()`
- [x] WS handshake auth middleware — validates token in `socket.handshake.auth.token`, attaches `socket.data.auth`
- [x] Update REST endpoints to call `authorizeUser` with `ctx.context.session.user.id` before running pipelines
- [x] Add `NotAuthorized` error type + FORBIDDEN mapping in `runPipeline`
- [x] Fix `middleware:` → `use:` on all endpoints (session middleware was silently ignored)
- [x] Create `pipelines/authorize.ts` — reusable Effect authorization step
- [x] Compatible with session cookies, bearer tokens, API keys, and JWTs (all produce same `ctx.context.session.user.id`)

### 11b. Full WS API — DONE
- [x] Full operation handlers: `check`, `can-use`, `consume`, `use-feature` — all reuse existing Effect pipelines
- [x] WS request-response pattern: `check` → `check:result`, `can-use` → `can-use:result`, `consume` → `consume:result`, `use-feature` → `use-feature:result`
- [x] All WS mutations broadcast `usage:updated` to room `usage:{feature}:{refId}` (belt-and-suspenders with Redis pub/sub)
- [x] `mapErrorToSocket` mirrors `runPipeline` error mapping — same error tags, emits via socket
- [x] `runWsPipeline` helper: runs Effect, emits result or error uniformly
- [x] `authorizeAndResolve` helper: authorize + resolveOverrideKey + resolveFeature in one step
- [x] WAL-aware: checks `walEnabled` from config for consume/use-feature

### 11c. Client WS Transport + Reconnection Fix — DONE
- [x] WS reconnection: on `connect` stop polling, re-subscribe to rooms. Socket.IO exponential backoff (1s→10s, infinite retries)
- [x] Auth token in `socket.handshake.auth.token` — `token` option on `TrackerOptions` (string or getter fn)
- [x] Client operations: `handle.consume()`, `handle.check()`, `handle.canUse()`, `handle.useFeature()` — WS when connected, REST fallback
- [x] `emitAndWait` pattern: emit event, one-shot listener for `:result`, 10s timeout, error matching by event name
- [x] Immutable state (`this.state = { ...this.state, [feature]: next }`) for `useSyncExternalStore`
- [x] `subscribe(cb)` / `getSnapshot()` public methods for framework integration
- [x] Direct state update from `usage:updated` payload when it contains full state (no refetch)
- [x] `referenceType` param on `track()` for multi-tenant scenarios

### 11d. Free/Anonymous Usage — SCRAPPED
Replaced by BetterAuth's `anonymous()` plugin. Anonymous users get real sessions with real user IDs — same auth pipeline, no special endpoints, no spoofable referenceIds. Document: "enable `anonymous()` plugin for free-tier usage."

## Phase 12: Framework Clients

### 12a. React Hooks — `@eggermarc/better-auth-usage/react` (`package/client/react.tsx`) — DONE
- [x] `UsageProvider` — creates tracker + handle, holds referenceId, `setReference(refId, refType)` to switch
- [x] `useUsage(feature)` — returns `{ usage, isAllowed, consume, check, canUse, useFeature }` via `useSyncExternalStore`
- [x] `useSetReference()` — access `setReference` to change tracked referenceId (e.g. switch org→user)
- [x] `useUsageEvent("threshold" | "blocked", handler)` — stable handler ref via `useRef`
- [x] Build config: `react` entry in `tsup.config.ts`, `./react` export in `package.json`, `react ^18 || ^19` optional peer dep
- [x] SSR-safe: server snapshot returns empty state, "use client" directive
- [x] Update example: anonymous auth, `UsageProvider`, `useUsage` hooks, zero-config WS

### 12b. Vue Composables — `@eggermarc/better-auth-usage/vue` (`package/client/vue.ts`)
- [ ] `useUsage`, `useFeatureUsage`, `useUsageActions`, `useUsageEvent` as Vue composables
- [ ] Uses `ref()` / `watchEffect()` with `subscribe()`/`getSnapshot()`

### 12c. Svelte Stores — `@eggermarc/better-auth-usage/svelte` (`package/client/svelte.ts`)
- [ ] Svelte store adapters wrapping `subscribe()`/`getSnapshot()`

### 12d. Solid Signals — `@eggermarc/better-auth-usage/solid` (`package/client/solid.ts`)
- [ ] `createStore`-based integration

### 12e. Angular Service — `@eggermarc/better-auth-usage/angular` (`package/client/angular.ts`)
- [ ] Injectable service with RxJS Observable wrappers

---

# Considerations

## Socket.IO → Native WebSockets

Socket.IO is the only dependency preventing the plugin from running on Cloudflare Workers (or any edge runtime). Cloudflare Workers support native WebSockets but not Socket.IO's protocol (HTTP long-polling upgrade, custom framing).

Our WS protocol is simple — emit event, get result, room-based pub/sub. None of this needs Socket.IO's features (namespaces, binary, auto-reconnect protocol). Rooms are a simple in-memory `Map<string, Set<WebSocket>>`.

**Migration path:**
- Replace `socket.io` server with native `WebSocket` upgrade handling (works on Hono, Node, Bun, Deno, Cloudflare)
- Replace `socket.io-client` with native `WebSocket` + thin wrapper for request-response pattern
- Reconnection: implement exponential backoff in the client (currently delegated to Socket.IO)
- Remove `socket.io` and `socket.io-client` from dependencies (~200KB saved)

**Impact:** `realtime/websocket-server.ts`, `realtime/usage-tracker.ts`, `runtime.ts`, `client.ts`. Pipelines and endpoints unchanged.

## Upstash Redis (HTTP) vs ioredis (TCP)

For serverless/edge deployments (Cloudflare, Vercel Edge), ioredis (TCP) doesn't work. Upstash Redis provides an HTTP-compatible API. The plugin already has partial Upstash support. Full migration would mean:
- Replace `ioredis` with `@upstash/redis` (HTTP client)
- Lua scripts work on Upstash (they support EVAL)
- Pub/sub works differently on Upstash — uses server-sent events or polling instead of persistent SUBSCRIBE
- WAL drain strategy would need to use "poll" mode (no persistent SUBSCRIBE on HTTP)

---

# Test Commands

```bash
bun run test          # 135 tests — e2e + unit (no Docker needed)
bun run test:redis    # 11 tests — Redis integration (requires: docker run -d -p 6399:6379 redis:7-alpine)
bun run test:perf     # 9 tests — performance benchmarks with [PERF] output
```

Note: `bun run test:redis` requires a running Redis on port 6399. These tests verify Lua script execution, WAL stream (XADD/XREADGROUP/XACK), pub/sub publishing, and concurrent writes (100 parallel increments). They are excluded from the default `bun run test` to avoid ioredis-mock conflicts.

---

# Current State: 135 tests, 0 failures, 14 test files (+ 11 infra tests)

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
├── client.ts             BetterAuth client plugin + reactive tracker (createUsageTracker)
├── client/react.tsx      React hooks (createUsageProvider, useFeature, useSetReference, useAllEvents)
├── services/             RedisService, DbService, LoggerService
├── pipelines/            All business logic (Effect) + authorize.ts
├── endpoints/            10 endpoints (thin wrappers, zero try-catch) + /usage/ws discovery
├── wal/                  WAL worker + recovery
├── adapters/lua/         increment.lua, set-meta.lua
└── realtime/             auth.ts, pure subscriber, full WS API handlers (Effect)
```
