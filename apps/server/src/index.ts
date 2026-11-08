import { durableObjectDriver, mountUsage } from "@eggermarc/better-auth-usage/cloudflare"
import { makeAuth } from "@repo/auth"
import { createDb } from "@repo/db"
import { env as cf, waitUntil } from "cloudflare:workers"
import { createFetch } from "./app"

// Worker entry — runs under wrangler dev (local D1 + DO) and on deploy. Export
// the DO class so the runtime can instantiate it (bound as USAGE_DO).
export { UsageDurableObject } from "@eggermarc/better-auth-usage/cloudflare"

const env = cf as { USAGE_DO: DurableObjectNamespace; DB: D1Database; SESSION_KV: KVNamespace }

// Place each usage DO in São Paulo (South America) — near our users, cutting the
// worker→DO round-trip. Only affects newly-created DOs.
const LOCATION_HINT = "sam" as const

// Fast session store — reads sessions from KV instead of D1 on every request
// (works for cookie, bearer, and API-key callers). KV min TTL is 60s.
const secondaryStorage = env.SESSION_KV
    ? {
        get: (key: string) => env.SESSION_KV.get(key),
        set: (key: string, value: string, ttl?: number) =>
            env.SESSION_KV.put(key, value, ttl && ttl > 60 ? { expirationTtl: ttl } : undefined).then(() => {}),
        delete: (key: string) => env.SESSION_KV.delete(key),
    }
    : undefined

const auth = makeAuth(
    durableObjectDriver({ namespace: env.USAGE_DO, locationHint: LOCATION_HINT }),
    createDb(env.DB),
    secondaryStorage,
    // waitUntil keeps the D1 history write alive after the response, and
    // Server-Timing shows driver/db time per request in DevTools.
    { background: waitUntil, serverTiming: true },
)

/**
 * GET /usage/debug/colo?referenceId=… returns the colo the edge Worker and that
 * reference's DO run in, to check whether `locationHint` actually placed it near
 * users. Requires a session.
 */
async function debugColo(request: Request): Promise<Response | null> {
    const url = new URL(request.url)
    if (url.pathname !== "/usage/debug/colo") return null

    const session = await auth.api.getSession({ headers: request.headers })
    if (!session) return new Response("Unauthorized", { status: 401 })

    const referenceId = url.searchParams.get("referenceId") ?? session.user.id
    const stub = env.USAGE_DO.get(env.USAGE_DO.idFromName(referenceId), { locationHint: LOCATION_HINT })
    const started = Date.now()
    const { colo } = await stub.fetch("https://do/debug/colo", { method: "POST" }).then((res) => res.json<{ colo: string }>())
    const doRoundTripMs = Date.now() - started
    const worker = (request as Request & { cf?: { colo?: string } }).cf?.colo ?? "unknown"

    return Response.json({ referenceId, worker, durableObject: colo, doRoundTripMs })
}

export default {
    fetch: createFetch(auth, async (req) =>
        (await debugColo(req)) ?? mountUsage(req, { namespace: env.USAGE_DO, auth, locationHint: LOCATION_HINT })
    ),
}
