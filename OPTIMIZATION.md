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

## Phase 2.5 — Fix the DO customer cache (setCustomer) (core) — DONE

Root cause: `upsertCustomer` **forked** `setCustomer` (`Effect.fork`). Effect's
structured concurrency interrupts the fork when the pipeline completes; a DO
round-trip is slower than the request, so the fetch was cut mid-flight and the DO
received an empty body → `put(undefined)`. Fix: **await** setCustomer (no fork) —
upsert is infrequent, so the round-trip is fine, and the DO cache now populates.
Verified: `put() called with undefined` gone; `check-customer` returns the cached
customer with `overrideKey`. (Same fork-doesn't-survive hazard that ruled out the
Phase-3 fork approach.)

Original outline below.

## Phase 2.5 (original outline) — Fix the DO customer cache (setCustomer) (core)

**Problem:** `upsert-customer` forks `driver.setCustomer`, but the DO throws
`put() called with undefined value` — `body.customer` arrives undefined at the DO.
Forked/silent, so correctness is fine (getCustomer falls back to DB), but the DO
customer cache **never populates**, so every customer lookup
(`resolveCustomerAndOverride` on every consume/check) does DO-getCustomer(miss) +
a **DB read**. Pre-existing; unrelated to Phases 1/2.

**Change:** Find why `body.customer` is undefined at the DO and fix the
setCustomer payload/handler (`drivers/cloudflare/index.ts` driver `call` +
`object.ts` `/setCustomer` case) so the customer actually caches. Likely the DO
`request.json()` shape or the driver payload; confirm by reproducing.

**Files:** `drivers/cloudflare/index.ts`, `drivers/cloudflare/object.ts`.

**Expected win:** getCustomer becomes a DO cache **hit** instead of DO-miss + DB
read → −1 DB read on every consume/check. Portable, no lock-in.

**Risk:** Low. Isolated to the DO customer path.

**Verify:** After upsert-customer, `check-customer` served from DO cache (no DB
read); no `put() called with undefined` in the DO log.

---

## Phase 3 (REVISED) — Durable driver: skip the redundant DB write (core) — DONE

Implemented: `durable?: boolean` on `UsageDriver` (forwarded via `DriverService`);
`durableObjectDriver` sets `durable: true`. consume: durable path appends only the
`usage_event` history (1 statement) via `appendUsageEvent` and skips the snapshot
upsert; getUsage: durable miss returns authoritative-empty (no DB fallback /
auto-create / hydrate fork). Verified on local DO: after two consumes the `usage`
table has **0 rows** for the ref (DO owns the counter) while `usage_event` holds
the history (deltas 5, 3); check/consume read correct totals from the DO; `pro`
override still auto-applies. D1 cost per consume: 3 sequential statements → 1.
tsc no new errors; tests 17/17.

Doc note: for DO deployments the `usage` snapshot table is intentionally unused —
read current usage via the plugin/driver, not raw DB. `usage_event` unaffected.

Details below.

## Phase 3 (REVISED, outline) — Durable driver: skip the redundant DB write (core)

Supersedes the original "fork / DO-WAL" plan below. Both rejected on **lock-in**:
DO-WAL forces raw D1 in the alarm flush (the better-auth adapter is
worker/request-scoped, unreachable in the DO); `ctx.waitUntil` is a Cloudflare
API. Both fight the BYO design (bring-your-own driver/DB/KV).

**Reframe:** the D1 write is a **redundant double-write** for the DO driver. DO
storage is itself durable (SQLite-backed, survives eviction), so the DO already
persists the counter. The plugin only writes the `usage` snapshot to D1 because it
treats every driver as an *ephemeral cache over the DB* — true for redis, false
for the DO. Treat the DO as the durable store it is.

**Change:**
1. Add an optional `readonly durable?: boolean` capability to `UsageDriver`
   (mirrors `wal`/`realtime`). The DO driver sets `durable: true`; memory/redis
   leave it unset (they remain cache-over-DB). Surface it through `DriverService`
   (like `wal`/`realtime` at `services/driver.ts`).
2. In `consumeUsage` (`pipelines/consume.ts`): when `driver.durable`, **skip the
   `usage` snapshot upsert** (the DO is the snapshot). Keep only the append-only
   `usage_event` history insert (1 statement) — cross-tenant analytics still wants
   it. So `writeToDb` drops from `findOne` + upsert + history-insert (3 sequential
   D1 statements, no txn on D1) → **1 insert**.
3. In `getUsage` (`pipelines/get-usage.ts`): when `driver.durable`, treat a driver
   miss as authoritative-empty — skip the D1 counter fallback + the auto-create +
   the hydrate fork (the DO owns the counter). Removes a DB read on cold reads.

**Files:** `drivers/types.ts` (capability), `services/driver.ts` (forward),
`drivers/cloudflare/index.ts` (`durable: true`), `pipelines/consume.ts`,
`pipelines/get-usage.ts`.

**Expected win:** consume D1 cost 3 sequential statements → 1 (history). No
`waitUntil`, no DO-WAL, no D1 lock-in — the write still goes through the
better-auth adapter, whatever DB that is.

**Risk:** Medium. Semantics change for DO users: the `usage` snapshot table is no
longer maintained (the DO is the source of truth). Anything reading `usage`
directly from the DB for a DO deployment must instead read via the plugin
(driver). `usage_event` history unaffected. Document it. Non-DO drivers unchanged.

**Optional follow-up (zero D1 in hot path):** the remaining `usage_event` insert
is append-only → the DO could buffer events in its own storage and expose them for
drain, OR make history opt-out per feature. Deferred — keeps history durable and
adds no lock-in as long as it doesn't require D1-in-DO.

**Verify:** consume on the DO driver issues exactly one D1 statement (history);
counter reads come from the DO; resets still fire (meta lives in the DO from
Phase 2). Re-measure prod timings.

---

## Phase 3 (original outline, OBSOLETE — rejected on lock-in) — fork / DO-WAL

**Problem:** DO driver has no WAL, so `consumeUsage` writes to D1 synchronously
before responding. The DO counter is already authoritative for the response.

Rejected approaches: `Effect.fork` (dies after response on Workers — no
`waitUntil`), `ctx.waitUntil` (Cloudflare-specific API), DO-WAL alarm flush
(forces raw D1 in the DO → D1 lock-in). Replaced by Phase 3 (REVISED) above.

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

Status: Phase 1 ✅, Phase 2 ✅. Remaining:

1. **Phase 2.5** (setCustomer DO cache): getCustomer becomes a DO hit → −1 DB read
   per consume/check. Cheap, portable.
2. **Phase 3 (REVISED)** (durable driver): consume D1 write 3 statements → 1;
   getUsage skips DB fallback on the durable driver. No lock-in.
   After 2.5 + 3: `use-feature` ≈ session + `getCustomer`(DO hit) +
   `consume`(DO) + 1 history insert; `check` ≈ session + `getCustomer`(DO hit) +
   `getUsage`(DO). Both ~2 DO hops, no blocking DB read/snapshot write.
3. **Phase 4** (client): browser `use-feature` drops ~one `check` round-trip.
4. **Phase 5** (infra): DO placement lowers the per-hop floor for everything.

Note: `check` still has 2 sequential DO hops (getCustomer → getUsage) because
getUsage depends on the override-resolved feature. Candidate follow-up: a combined
DO read (customer + usage in one round-trip, same DO instance) → check to 1 hop.

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
