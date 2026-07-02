# Usage Plugin — Latency Optimization Plan

Reducing per-request latency for the Durable Object driver in production
(`apps/server` → `api.better-auth-usage.com`).

## Baseline (measured, prod, warm)

| Operation | cold | warm | Cost breakdown |
|-----------|------|------|----------------|
| `get-session` (auth only) | — | 0.058s | cheap |
| `check` | 1.49s | ~0.65–0.73s | 2 sequential DO hops + session |
| `use-feature` | 1.56s | ~1.1s | 3 sequential DO hops + blocking D1 write txn |

- **~300ms per DO round-trip** is the dominant unit cost.
- Session lookup is NOT the bottleneck (58ms).
- Browser-observed `use-feature` ≈ 4.3s — server is ~1.1s; the remaining ~3s is
  client-side: tracker init, geographic distance inflating each DO hop, and a
  trailing `check` refetch triggered by every broadcast (see Phase 4).

### Round-trip inventory (current)

`check`: `resolveOverrideKey`→`getCustomer`(DO) → `checkUsage`→`getUsage`(DO)

`use-feature` (`consumeUsage`):
1. `resolveOverrideKey` → `getCustomer` (DO hop 1)
2. `Effect.all([getUsage, getCustomerOptional])` → `getUsage` (DO hop 2) ∥ `getCustomer` (DO hop 3, **redundant with hop 1**)
3. `driver.consume` (DO hop 4)
4. DO driver has no WAL → **blocking D1 transaction** (update `usage` + insert `usageEvent`)

Goal: `use-feature` from 3 sequential DO hops + blocking write → **1 DO hop**,
DB write off the hot path.

---

## Phase 1 — Kill the redundant `getCustomer` (core) — DONE

Implemented: `resolveCustomerAndOverride` (one customer lookup returning
`{customer, overrideKey}`); consume/use-feature endpoints pass the resolved
`customer` into `consumeUsage`, which no longer re-fetches. handler.ts updated to
match. check/can-use/sync keep `resolveOverrideKey` (single fetch, no
redundancy). Verified end-to-end on local DO; core tests green.

### Bugs found & fixed while verifying (DO driver correctness)

1. **`json(data ?? {})` in `drivers/cloudflare/object.ts`** coerced `null` → `{}`,
   so a `getCustomer`/`getUsage` cache miss returned a truthy empty object. The
   driver treated it as a hit and skipped the DB fallback → **overrides from the
   customer were silently ignored** and fresh usage reads were wrong. Fixed:
   `data ?? null`. (Prod impact: auto-override never applied on the DO.)
2. **`hydrate` race:** with (1) fixed, `getUsage` on a fresh miss forks
   `hydrate(current=0)` which could land *after* a concurrent `consume` and clobber
   the counter back to 0. Fixed: DO `hydrate` primes the counter only when the DO
   has none — it never regresses a live counter (only `reset()` forces the value).
   Bug (1) had been masking this.

Original outline below.

## Phase 1 (original outline) — Kill the redundant `getCustomer` (core)

**Problem:** Customer is fetched in `resolveOverrideKey`, then fetched again
inside `consumeUsage` via `getCustomerOptional`. Two DO round-trips for the same
row.

**Change:** Resolve the customer once at the endpoint/pipeline entry, thread the
resolved `customer` (and its `overrideKey`) into `consumeUsage`/`checkUsage`
instead of re-fetching. `resolveOverrideKey` returns the customer it already
loaded rather than just the key.

**Files:** `packages/core/src/pipelines/resolve-override.ts`,
`pipelines/consume.ts`, `pipelines/check.ts`, `realtime/handler.ts` (shares
`authorizeAndResolve`), endpoints that call these.

**Expected win:** −1 DO hop on every consume (~300ms).

**Risk:** Low. Pure plumbing; no behavior change.

**Verify:** Local DO run — consume returns correct `current`; count DO fetches
drops by one (log/trace).

---

## Phase 2 — Skip `getUsage` in consume when no `before` hook (core) — DONE

Implemented as **self-priming consume** (bigger than the original outline —
`getUsage` also primed the driver's reset meta, so a naive skip would have stopped
resets firing):
- `ConsumeArgs` gained optional `resetValue` / `resetAt` / `maxLimit` / `minLimit`.
- The consume pipeline passes the feature's limits + next reset boundary
  (`shouldReset(null, reset).nextReset`) into `driver.consume`.
- DO (`object.ts`) and memory drivers self-prime their meta from those args and
  apply reset boundaries — no prior `hydrate` needed. Other drivers ignore the
  new optional fields.
- `consume` now calls `getUsage` **only** when a `before` hook needs the
  pre-consume total (after-hook derives `beforeAmount = newTotal - amount`). On
  driver failure it lazily reads for the DB fallback.
- `writeToDb` upserts the `usage` snapshot (create-if-missing) since `getUsage`
  no longer auto-creates the row.

Verified on local DO: consume-first (no prior check) self-primes and accumulates
(+7→7, +3→10, check→10), `pro` override auto-applies (max 100000), never-reset
feature works, D1 snapshot upserted (api-calls=10, credits=50) and history
appended (usage_event deltas 7/3/50). Net: `use-feature` drops from 3 sequential
DO hops → 1 (`driver.consume`) when there's no before hook.

### Discovered (pre-existing) — DO customer cache never populates

`upsert-customer` forks `driver.setCustomer`, but the DO throws
`put() called with undefined value` (`body.customer` arrives undefined at the DO).
Forked → silent → non-blocking (getCustomer falls back to DB, correctness fine),
but it means **every customer lookup pays a DB read instead of a DO cache hit**.
Perf follow-up — fix the setCustomer DO payload/handler so the customer caches.
Unrelated to Phase 1/2 code (object.ts `setCustomer` untouched).

## Phase 2 (original outline) — Skip `getUsage` in consume when no `before` hook (core)

**Problem:** `consumeUsage` calls `getUsage` to compute `beforeAmount`, but
`driver.consume` already returns `newTotal`. `beforeAmount` is only needed to
feed a `before`/`after` hook. Prod config defines no hooks.

**Change:** Only call `getUsage` when `feature.hooks?.before` (or `after`) exists.
Otherwise skip straight to `driver.consume` and derive the result from
`outcome.newTotal`.

**Files:** `packages/core/src/pipelines/consume.ts`.

**Expected win:** −1 DO hop on hookless consume (~300ms). Combined with Phase 1,
`use-feature` drops from 3 DO hops → 1 (just `driver.consume`).

**Risk:** Low–medium. Must preserve hook semantics (before/after still get correct
before/after amounts when defined). `after` hook uses `newTotal` (already
available); `before` hook needs `beforeAmount` → keep `getUsage` in that branch.

**Verify:** Hook tests (before blocks over-limit, after fires) + hookless fast path.

---

## Phase 3 — Take the D1 write off the consume hot path (core)

**Problem:** DO driver has no WAL, so `consumeUsage` writes to D1 synchronously
(a 2-statement transaction) before responding. The DO counter is already
authoritative for the response.

**Change (interim):** `Effect.fork` the `writeToDb` call — fire-and-forget with
error logging, so the response returns on the DO outcome. Accept eventual
consistency for the `usage`/`usageEvent` snapshot+history (already the model for
WAL drivers).

**Change (durable, later):** Give the DO driver a real WAL capability — buffer
consume events in DO storage, flush to D1 via a DO `alarm`. This is the
alarm-flush path deliberately deferred earlier (see `byo_driver_migration`
notes). Removes the write from the hot path *and* keeps durability/ordering.

**Files:** `packages/core/src/pipelines/consume.ts` (interim);
`drivers/cloudflare/object.ts` + `drivers/cloudflare/index.ts` (WAL version).

**Expected win:** −(D1 txn) from the hot path. Combined with 1+2, `use-feature`
≈ session + 1 DO hop (~0.4s).

**Risk:** Interim fork — a crash between DO write and D1 flush drifts the D1
snapshot until the next consume/sync. Errors must be logged. The WAL version
removes this risk.

**Verify:** Consume returns before D1 write completes (timing); D1 row eventually
matches DO counter.

---

## Phase 4 — Client: stop refetching on every broadcast ("bug 2")

**Problem:** DO broadcasts carry `newTotal` but not `current`/`status`, so the
client's event handler always falls through to `fetchOne` → a REST `check` after
every consume. In the UI this appends a full round-trip to each mutation.

**Change:** Update client state in place from the broadcast payload (`newTotal` →
current; recompute status/remaining from known limits) instead of refetching.
Make `updateFeature` preserve existing `max`/`min` when the payload omits them.

**Files:** `packages/core/src/client.ts`.

**Expected win:** Removes one `check` round-trip per UI consume (~0.65s of the
browser-observed time). Also cuts API load ("checkUsage spam").

**Risk:** Low. Client-only; state math already normalizes `newTotal`.

**Verify:** Browser/tracker test — a consume updates state with no follow-up
`check` request.

---

## Phase 5 — DO placement (infra)

**Problem:** ~300ms per DO round-trip suggests the DO colo is distant from the
worker (or hibernation wake cost). This is the base unit every hop pays.

**Change:** Set a Durable Object `locationHint` near the primary region / D1,
and/or enable Smart Placement on the worker so it runs close to the DO. Evaluate
after Phases 1–3 (fewer hops makes per-hop latency less critical, but it still
sets the floor).

**Files:** `packages/infra/alchemy.run.ts` (DO namespace / worker config),
`apps/server/wrangler.jsonc`.

**Expected win:** Lower per-hop floor (target <100ms same-region). Multiplies
across every remaining hop.

**Risk:** Placement trade-offs (a DO near D1 may be far from some users). Measure.

**Verify:** Re-run the prod curl timings; per-hop cost drops.

---

## Sequencing & expected outcome

1. Phases 1–3 (core) together: `use-feature` ~1.1s → ~0.4s; `check` ~0.65s →
   ~0.4s (still 2 hops unless we also parallelize customer∥usage — candidate
   follow-up once the customer is passed in).
2. Phase 4 (client): browser `use-feature` drops by ~one `check` round-trip.
3. Phase 5 (infra): lowers the per-hop floor for everything.

## Measurement protocol

Repeat before/after each phase (warm, ×4, discard first):

```
sign-up → upsert-customer → check ×4 → use-feature ×4
curl -w "%{time_total}s"  against api.better-auth-usage.com
```

Track: total time, and (via logging) DO-fetch count per request.

## Notes / non-goals

- No new endpoints; reuse `check` / `use-feature` REST.
- Keep WS as realtime push only (mutations over REST) — the Phase-1 bug fix.
- `check`'s 2 hops (customer + usage) are sequential because `getUsage` needs the
  override-resolved feature. After Phase 1 (customer passed in), customer and
  base-usage could be fetched in parallel and the limit applied after — a
  possible check-specific follow-up.
