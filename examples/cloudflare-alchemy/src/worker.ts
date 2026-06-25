import { mountUsage } from "@eggermarc/better-auth-usage/cloudflare"
import { makeAuth } from "./auth"
import type { Env } from "./env"

// Export the Durable Object class so the Workers runtime can instantiate it.
// Must match the `className` in alchemy.run.ts.
export { UsageDurableObject } from "@eggermarc/better-auth-usage/cloudflare"

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const auth = makeAuth(env)

        // 1. Realtime: route the WebSocket upgrade to the per-referenceId DO.
        //    Authenticates the session, then shards by `?referenceId=`.
        const ws = await mountUsage(request, { namespace: env.USAGE_DO, auth })
        if (ws) return ws

        // 2. Everything else → better-auth (REST usage endpoints, sign-in, …).
        return auth.handler(request)
    },
}
