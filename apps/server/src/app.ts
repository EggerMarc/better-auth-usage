import { RPCHandler } from "@orpc/server/fetch"
import { env } from "@repo/env/server"
import type { Auth } from "@repo/auth"
import { router } from "./router"

const rpc = new RPCHandler(router)

/** CORS for the cross-origin web app (credentials → must echo a concrete origin). */
function corsHeaders(origin: string | null): Record<string, string> {
    return {
        "Access-Control-Allow-Origin": origin ?? env.CORS_ORIGIN,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
    }
}

/**
 * The request handler, shared by both entries. `mountWs` (Durable Object WS
 * routing) is only wired in the Worker entry — under bun dev there's no DO, so
 * the realtime client auto-degrades to polling.
 */
export function createFetch(auth: Auth, mountWs?: (req: Request) => Promise<Response | null>) {
    return async (request: Request): Promise<Response> => {
        const url = new URL(request.url)
        const origin = request.headers.get("Origin")

        // CORS preflight.
        if (request.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: corsHeaders(origin) })
        }

        // WebSocket upgrade (Worker only) — return as-is (101, no CORS).
        if (mountWs) {
            const ws = await mountWs(request)
            if (ws) return ws
        }

        let res: Response
        if (url.pathname.startsWith("/rpc")) {
            const { matched, response } = await rpc.handle(request, { prefix: "/rpc", context: { auth } })
            res = matched && response ? response : new Response("Not found", { status: 404 })
        } else if (url.pathname.startsWith("/api/auth")) {
            res = await auth.handler(request)
        } else {
            res = new Response("OK")
        }

        // Attach CORS to the response.
        const out = new Response(res.body, res)
        for (const [k, v] of Object.entries(corsHeaders(origin))) out.headers.set(k, v)
        return out
    }
}
