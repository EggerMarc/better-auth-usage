# Cloudflare-native usage (Durable Object) + Alchemy

Runs `@eggermarc/better-auth-usage` fully on Cloudflare: the **Durable Object
driver** keeps the atomic counter and the realtime WebSocket connections in one
object per `referenceId` — no Redis, no pub/sub, sub-region-RTT fan-out.

Provisioned with [Alchemy](https://alchemy.run) (TypeScript-native IaC).

## Wiring (3 pieces)

1. **Driver** — `usage({ driver: durableObjectDriver({ namespace: env.USAGE_DO }) })`
   (`src/auth.ts`).
2. **WS routing** — `mountUsage(request, { namespace, auth })` at the top of the
   Worker `fetch`, plus re-exporting `UsageDurableObject` (`src/worker.ts`).
3. **Infra** — a `DurableObjectNamespace("usage", { className: "UsageDurableObject" })`
   bound to the Worker (`alchemy.run.ts`).

## Run

```bash
bun install
export BETTER_AUTH_SECRET="$(openssl rand -base64 32)"
bun alchemy.run.ts            # deploy
bun alchemy.run.ts --destroy  # tear down
```

## How the client connects

The browser client (`createUsageTracker`) calls `GET /usage/ws`, which the DO
driver answers with the same-origin `wss://…/usage/ws` URL. The client opens a
WebSocket there with `?referenceId=<org>`; `mountUsage` authenticates the session
and forwards the upgrade to that reference's Durable Object. Consumes (REST) hit
the same DO, which broadcasts the new total to every subscribed socket.

## Not using Alchemy?

The same Worker runs under `wrangler` — declare the DO binding in `wrangler.jsonc`:

```jsonc
{
  "durable_objects": {
    "bindings": [{ "name": "USAGE_DO", "class_name": "UsageDurableObject" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["UsageDurableObject"] }]
}
```
