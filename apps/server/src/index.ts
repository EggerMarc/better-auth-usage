import { RPCHandler } from "@orpc/server/fetch"
import { mountUsage } from "@eggermarc/better-auth-usage/cloudflare"
import { createAuth } from "@repo/auth"
import { env } from "@repo/env/server"
import { router } from "./router"

// Export the Durable Object class so the Workers runtime can instantiate it.
// Bound as USAGE_DO in packages/infra/alchemy.run.ts.
export { UsageDurableObject } from "@eggermarc/better-auth-usage/cloudflare"

const rpc = new RPCHandler(router)

export default {
    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url)
        const auth = createAuth()

        // 1. Realtime: route the WebSocket upgrade to the per-referenceId DO.
        const ws = await mountUsage(request, { namespace: env.USAGE_DO, auth })
        if (ws) return ws

        // 2. oRPC routes.
        if (url.pathname.startsWith("/rpc")) {
            const { matched, response } = await rpc.handle(request, { prefix: "/rpc", context: { auth } })
            if (matched) return response
        }

        // 3. better-auth (sign-in/up + the usage REST endpoints).
        if (url.pathname.startsWith("/api/auth")) {
            return auth.handler(request)
        }

        return new Response("OK")
    },
}
