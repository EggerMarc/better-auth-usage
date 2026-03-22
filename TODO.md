# TODO — E2E Test Coverage Plan (COMPLETED)

## Phase 1: Fix 4 Failing Tests (Singleton Issue)
- [x] Re-export `shutdownUsage` from `tests/test-helper.ts`
- [x] Add `beforeEach/afterAll` with `shutdownUsage()` to hooks describe blocks in `tests/overrides-hooks-customer.test.ts`
- [x] Add `beforeAll/afterAll` with `shutdownUsage()` to hooks describe block in `tests/cache.test.ts`
- [x] Verify all 4 previously-failing tests now pass

## Phase 2: Fix `checkLimit` Bug
- [x] Fix truthy check on `maxLimit` and `minLimit` in `package/utils.ts:24-25` (use `!= null` instead)

## Phase 3: New File `tests/auth-validation.test.ts`
- [x] Test: `POST /usage/consume` without session returns error
- [x] Test: `POST /usage/check` without session returns error
- [x] Test: `POST /usage/check-customer` without session returns error
- [x] Test: `POST /usage/upsert-customer` without session returns error
- [x] Test: consume missing `featureKey` returns validation error
- [x] Test: consume missing `amount` returns validation error
- [x] Test: check missing `referenceId` returns validation error

## Phase 4: Boundary & Edge Cases in `tests/consume-check.test.ts`
- [x] Test: max limit exceeded — consume 101 on api-calls (max 100), check returns `above-max-limit`
- [x] Test: min limit boundary — consume -600 on credits (min -500), check returns `below-min-limit`
- [x] Test: zero amount consume succeeds, usage unchanged
- [x] Test: large amount consume records correctly
- [x] Test: check with nonexistent feature returns error
- [x] Test: consume without prior customer creation returns error

## Phase 5: Customer & Feature Extras in `tests/overrides-hooks-customer.test.ts`
- [x] Test: upsert customer with `overrideKey` persists the field
- [x] Test: get single feature with `overrideKey` returns merged config
- [x] Test: list features returns `details` array when features have it
- [x] Test: both before and after hooks on same feature

## Phase 6: Sync/Reset Coverage in `tests/sync-reset.test.ts`
- [x] Test: sync that actually triggers reset (hourly reset)
- [x] Test: sync with nonexistent feature returns error

## Phase 7: Cache-Specific Gaps in `tests/cache.test.ts`
- [x] Test: cache-enabled sync with no reset needed
- [x] Test: cache-enabled sync on monthly feature
- [x] Test: cache-enabled check with nonexistent feature

---

# TODO — Known Bugs & Issues

## Critical

- [ ] **`normalizeData` reads nonexistent `updatedAt` field** — `package/utils.ts:157` accesses `d.updatedAt`, but `cached_usageSchema` has no `updatedAt` field. `createdAt` is always `undefined` when normalizing cache data. Should use `d.lastResetAt` or add the field to the schema.

- [ ] **Lua `tonumber()` on ISO date string returns nil** — `package/adapters/lua/increment.lua:15` does `tonumber(limit.resetAt)` but `resetAt` is stored as an ISO string via `toISOString()` in `cache.ts:setLimit`. `tonumber` returns `nil` for ISO strings, so the reset check on line 24 never triggers — resets never happen in the cache layer.

- [ ] **Lua reset logic returns stale `newAmount`** — `increment.lua:22-30`: `newAmount` is calculated as `current + amount` before the reset check. After reset, `current` is set to `resetValue` but the old `newAmount` is returned. The returned value doesn't reflect the reset.

- [ ] **Lua `INCRBY` after reset double-counts** — `increment.lua:26-28`: after reset it does `DEL`, `SET key resetValue`, `INCRBY key amount`. Redis ends up with `resetValue + amount`, but the returned `newAmount` is `oldCurrent + amount`. These won't match.

## Bugs

- [ ] **Hardcoded event name on DB-only path** — `package/resolvers/insert-usage.ts:82` hardcodes `event: "usage"` instead of using the actual `event` parameter. The cache path (line 54) correctly uses `event`.

- [ ] **Fire-and-forget DB write when cache is enabled** — `package/resolvers/insert-usage.ts:50-58`: `adapter.insertUsage()` is not awaited when cache is present. If it fails, the error log is empty (`[ERROR][]`), and the endpoint returns success even though the DB write may have failed. DB and cache silently drift.

- [ ] **Schema shape mismatch: `Usage` spread into `insertEvent`** — `package/resolvers/get-usage.ts:80-81` spreads a full `Usage` object into `insertEvent`, but `cached_usageEventSchema` expects only `referenceId`, `feature`, `amount`, `event`. Extra fields like `createdAt` leak into the cache entry.

- [ ] **No initial usage creation path** — `get-usage.ts:87-92` throws `NOT_FOUND` when there's no existing record. First-time usage for a new reference will always 404. There's a TODO comment acknowledging this.

## Code Quality

- [ ] **Silent `.catch(() => {})` swallowing errors everywhere** — Multiple locations silently swallow errors with no way to diagnose failures:
  - `get-usage.ts:72, 82` — cache `setLimit` and `insertEvent`
  - `insert-usage.ts:56` — empty message `[ERROR][]`
  - `insert-usage.ts:110` — `resolveSyncUsage` completely swallowed
  - `sync-usage.ts:57` — sync failures swallowed

- [ ] **`resetValue` not used in non-Lua paths** — `cached_limitsSchema` defines `resetValue` and it's used in the Lua script, but the TypeScript reset logic in `utils.ts` (`shouldReset`) doesn't account for it. DB path ignores non-zero reset values entirely.

---

# Improvements

## Architecture

- [ ] **Cache/tracker/socket created per-request, not once** — `package/resolvers/options.ts` creates new `UsageCache`, `UsageTracker`, and `SocketServer` instances on every endpoint call. This means new Redis connections per request, memory leak risk, and realtime updates won't actually work (each request gets its own socket server). Should be initialized once at plugin startup and shared.

- [ ] **No connection lifecycle management** — No `.disconnect()` calls in error paths, no graceful shutdown handling, no health checks for Redis connectivity.

- [ ] **DB queries fetch all rows then sum in JS** — `package/adapters/queries/get-usage.ts` fetches every usage record for a reference and sums them in-memory. For a customer with 10k events, this pulls all 10k rows. Should use a database-level `SUM()` aggregate.

- [ ] **No idempotency keys** — No way to safely retry consumption requests. A client timeout + retry can double-count usage. Consider idempotent event IDs.

- [ ] **No transaction spanning cache + DB** — Cache and DB writes are independent. Either can succeed while the other fails, with no reconciliation mechanism beyond the sync resolver (which is also fire-and-forget).

## Validation

- [ ] **No input validation on `amount`** — `consume-feature` and `check-usage` endpoints accept any number: negative, zero, `Infinity`, `NaN`. Should validate `amount > 0` and within safe integer bounds.

- [ ] **No validation on plugin config at init** — `package/index.ts` doesn't validate that features is non-empty, that `maxLimit >= minLimit`, or that reset config is coherent. Misconfigurations silently produce wrong behavior.

- [ ] **Realtime requires `port` but not checked until runtime** — `enableRealtime: true` requires `port` in options, but this isn't enforced at startup. Fails at first request instead.

## Security

- [ ] **No authentication on sensitive endpoints** — `list-features`, `get-feature`, and `sync-usage` have no auth middleware. Feature definitions and usage data are exposed without access control.

- [ ] **`authorizeReference` hook is optional with no fallback** — Without it, any caller can read/write any reference's usage. Should at minimum log a warning or require explicit opt-out.

- [ ] **Middleware is commented out** — `consume-feature.ts` has middleware imports commented out (lines 25-26). The middleware files in `package/middlewares/` exist but are unused.

- [ ] **No input sanitization for Redis keys** — `resolveKeys()` builds cache keys from user-provided `referenceId` and `featureKey` without sanitization. Malicious input could manipulate key namespaces.

## Observability

- [ ] **Inconsistent logging prefixes** — Mix of `[bau]`, `[LOG]`, `[ERROR]`, `[better-auth-usage]` with no structured format. Should standardize on one prefix and severity level.

- [ ] **Debug logs with excessive newlines** — `package/adapters/cache.ts` lines 160, 167, 173, 182 have `\n\n\n` in log output. Should be cleaned up or use a proper logger.

- [ ] **No cache hit/miss metrics** — No way to know if the cache layer is actually helping. Should track hit rate, latency difference, and sync frequency.

- [ ] **No audit trail for limit changes** — Customer limit updates and overrides aren't logged. No way to trace who changed what.

## Testing

- [ ] **No tests for cache paths** — Tests only cover the DB-only flow. No tests for cache initialization failures, cache hit/miss, Lua script behavior, or cache-DB sync.

- [ ] **No tests for concurrent requests** — Race conditions between simultaneous consume calls to the same feature/reference are untested.

- [ ] **No tests for feature hooks** — `before`/`after` hooks on features are untested. No coverage for hook exceptions propagating or blocking.

- [ ] **No tests for edge cases** — Missing coverage for: `Number.MAX_SAFE_INTEGER`, negative amounts, zero amounts, missing features, expired resets, first-time usage creation.

## Performance

- [ ] **N+1 query in insert-usage** — `resolvers/insert-usage.ts:21-24` calls `resolveGetUsage` and `resolveGetCustomer` separately. Each independently hits cache/DB. Could combine where applicable.

- [ ] **Redundant `HGETALL` on every cache read** — `cache.ts:112-129` fetches all limit fields on every usage read. If limits rarely change, this is wasteful. Could cache limits with a longer TTL.

## DX & API Completeness

- [ ] **No bulk operations** — No batch consume (multiple features at once), no bulk customer creation, no multi-customer reset.

- [ ] **No manual reset endpoint** — No way for admins to manually reset a customer's usage counter.

- [ ] **No usage history endpoint** — Can only query current aggregate, not historical usage events.

- [ ] **Client has no error handling guidance** — `package/client.ts` returns raw responses with no typed errors, no retry logic, no offline support.

## Code Quality

- [ ] **Dead code** — `package/middlewares/` files are commented out in endpoints. `package/adapters/lua/set-limit.lua` is an empty file. `schema.ts:9-17` has commented-out `featureLimits`.

- [ ] **Inconsistent naming** — `cached_Usage.current` vs `Usage.amount` for the same concept. `insertEvent` (cache) vs `insertUsage` (adapter) for similar operations. Event type strings (`"usage"`, `"reset"`, `"sync"`, `"use"`) are scattered as magic strings with no enum.

- [ ] **Reset timezone sensitivity** — `utils.ts:48-102` uses local JS `Date` methods (`getDay()`, `getMonth()`) for reset calculations. Resets will fire at different times depending on server timezone. Should use UTC consistently.

- [ ] **`shouldReset` can loop excessively** — `utils.ts:31-34` loops forward through reset periods with no iteration cap. A very old `lastResetAt` with a short reset interval could cause thousands of iterations.
