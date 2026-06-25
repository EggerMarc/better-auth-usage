/// <reference types="@cloudflare/workers-types" />
import type { CachedUsage, CachedLimits, ConsumeArgs, ConsumeOutcome, Customer } from "@/types"
import type { UsageDriver } from "../types"

export { UsageDurableObject } from "./object"
export { UsageStore, type DOStorageLike } from "./object"

export interface DurableObjectDriverConfig {
    /** The Durable Object namespace binding (one DO per referenceId). */
    namespace: DurableObjectNamespace
    /** WS path the client connects to (default `/usage/ws`). */
    wsPath?: string
}

/**
 * Worker-side handle for the Durable Object driver. Routes each store op to the
 * DO sharded by `referenceId` (so all of a reference's consumes — and its held
 * WebSocket connections — live in one single-threaded object: atomic counter +
 * zero-hop fan-out, no Redis, no pub/sub).
 *
 * Pair with `mountUsage` in your Worker `fetch` to route the WS upgrade, and
 * export `UsageDurableObject` from your entrypoint.
 */
export function durableObjectDriver(config: DurableObjectDriverConfig): UsageDriver {
    const ns = config.namespace
    const stubFor = (referenceId: string) => ns.get(ns.idFromName(referenceId))

    const call = async <T>(referenceId: string, path: string, payload: unknown): Promise<T> => {
        const res = await stubFor(referenceId).fetch(`https://do${path}`, {
            method: "POST",
            body: JSON.stringify(payload),
            headers: { "content-type": "application/json" },
        })
        if (!res.ok) throw new Error(`DO ${path} failed: ${res.status}`)
        return res.json() as Promise<T>
    }

    return {
        name: "durable-object",

        consume: (args: ConsumeArgs) => call<ConsumeOutcome>(args.referenceId, "/consume", args),

        getUsage: async (referenceId, feature) => {
            const r = await call<CachedUsage | null>(referenceId, "/getUsage", { referenceId, feature })
            if (!r) return null
            return { ...r, lastResetAt: r.lastResetAt != null ? new Date(r.lastResetAt as any) : null }
        },

        hydrate: (referenceId, feature, usage: CachedUsage, meta: CachedLimits) =>
            call(referenceId, "/hydrate", { referenceId, feature, usage, meta }).then(() => {}),

        reset: (referenceId, feature, value, meta) =>
            call(referenceId, "/reset", { referenceId, feature, value, meta }).then(() => {}),

        getCustomer: (referenceId) => call<Customer | null>(referenceId, "/getCustomer", { referenceId }),
        setCustomer: (customer: Customer) =>
            call(customer.referenceId, "/setCustomer", { referenceId: customer.referenceId, customer }).then(() => {}),
        delCustomer: (referenceId) => call(referenceId, "/delCustomer", { referenceId }).then(() => {}),

        realtime: {
            // Fan-out happens inside the DO (it holds the sockets) — nothing to
            // bridge on the Worker side.
            onUsageEvent: () => () => {},
            endpointInfo: (baseURL: string) => ({
                enabled: true,
                url: baseURL.replace(/^http/, "ws") + (config.wsPath ?? "/usage/ws"),
            }),
        },

        close: async () => {},
    }
}

/** Minimal shape of a better-auth instance needed to authenticate a WS upgrade. */
interface AuthLike {
    api: { getSession(opts: { headers: Headers }): Promise<unknown> }
}

/**
 * Route a WebSocket upgrade to the right Durable Object. Call at the top of your
 * Worker `fetch`; returns a `Response` when it handled the request, else `null`
 * (continue to the better-auth handler).
 *
 * Authenticates the session on the Worker (the DO trusts the upgrade), then
 * shards by the `?referenceId=` query param.
 */
export async function mountUsage(
    request: Request,
    opts: { namespace: DurableObjectNamespace; auth: AuthLike; wsPath?: string },
): Promise<Response | null> {
    const url = new URL(request.url)
    const wsPath = opts.wsPath ?? "/usage/ws"
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket" || !url.pathname.endsWith(wsPath)) {
        return null
    }
    const session = await opts.auth.api.getSession({ headers: request.headers }).catch(() => null)
    if (!session) return new Response("Unauthorized", { status: 401 })

    const referenceId = url.searchParams.get("referenceId")
    if (!referenceId) return new Response("referenceId query param required", { status: 400 })

    const ns = opts.namespace
    return ns.get(ns.idFromName(referenceId)).fetch(request)
}

export type { UsageDriver } from "../types"
