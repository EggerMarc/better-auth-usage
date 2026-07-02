# Security Hardening — DEFERRED until after the latency optimization

Status: **known, not yet fixed.** The usage endpoints are client-facing (mounted
under `/api/auth`, called directly by the browser tracker) and currently gated
only by "is authenticated". Track and fix these after `OPTIMIZATION.md` lands.

---

## VULN 1 — `referenceId` is caller-controlled and never authorized

**Where:** all usage endpoints (`check`, `can-use`, `consume`, `use-feature`,
`sync`, `upsert-customer`, `check-customer`) take `referenceId` from the request
body. Each calls `authorizeUser(...)`, but `packages/auth/src/index.ts` does
**not** configure `authorizeUser`, so `pipelines/authorize.ts` short-circuits to
open access (`if (!options.authorizeUser) return Effect.void`).

**Impact:** any authenticated user (including anonymous-plugin sessions) can pass
an arbitrary `referenceId` and:
- `check`/`consume`/`use-feature` another tenant's counters — read or inflate them.
- `sync` another tenant — force resets.
- `upsert-customer`/`check-customer` another tenant — clobber/read their customer row.

Cross-tenant read + write. No ownership check binds `referenceId` to the session.

**Fix:** configure `authorizeUser` in `packages/auth/src/index.ts` to bind the
`referenceId` to the session user.
- Personal refs: `authorizeUser: ({ userId, referenceId }) => referenceId === userId`.
- Org/team refs: look up membership (`userId` ∈ members of `referenceId`) — needs
  an org-membership check, so this is app-specific.

---

## VULN 2 — `overrideKey` (the plan) is accepted from the client body → entitlement escalation

**Where:** `consume` / `check` / `use-feature` body schemas include
`overrideKey: z.string().optional()`, and `resolveCustomerAndOverride` lets the
**body value win** over the customer record
(`overrideKey ?? customer?.overrideKey`). `upsert-customer` also accepts
`overrideKey` from the body.

**Impact:** a user self-selects their plan. E.g.
```
POST /usage/use-feature { featureKey:"api-calls", referenceId:"<self>", overrideKey:"pro" }
```
→ instant `pro` limits (1000 → 100000). Metering bypassed entirely. No customer
record or billing needed. Via `upsert-customer` they can also persist
`overrideKey:"pro"` on themselves. Independent of VULN 1 — even with `referenceId`
correctly bound to the user, they can still elevate their own plan.

**Fix:** the plan must come from trusted server-side state (subscription/billing),
never a request body.
- Drop `overrideKey` from the client-facing body schemas (`consume`/`check`/
  `use-feature`), and always resolve it from the customer record.
- Restrict `upsert-customer` (and its `overrideKey`) to server-side callers, or
  strip `overrideKey` from its client-accepted body. Plans get assigned by billing,
  not by the client.

---

## VULN 3 — `upsert-customer` / `check-customer` are client-reachable

`upsert-customer` provisions customers and (today) sets `overrideKey`;
`check-customer` reads customer PII (email, name). Both are session-gated only.
Should be server-only or, at minimum, behind VULN-1 authorization + VULN-2
overrideKey lockdown.

---

## Suggested order (post-optimization)

1. Wire `authorizeUser` (VULN 1) — smallest change, closes cross-tenant access.
2. Strip client `overrideKey` from consume/check/use-feature; resolve plan
   server-side only (VULN 2).
3. Lock down `upsert-customer` / `check-customer` (VULN 3).

Note: these are plugin/app-config changes (`packages/auth/src/index.ts` +
client-facing body schemas in `packages/core/src/endpoints/*`), not deploy infra.
