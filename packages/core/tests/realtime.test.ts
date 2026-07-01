import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { betterAuth, type BetterAuthPlugin } from "better-auth"
import { bearer } from "better-auth/plugins/bearer"
import { createAuthClient } from "better-auth/client"
import Redis from "ioredis"
import { usage } from "../src/index"
import { resetRuntime } from "../src/runtime"

const REDIS_URL = "redis://localhost:6379"
const PORT = 39517

async function redisAvailable(): Promise<boolean> {
    const probe = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => null })
    probe.on("error", () => {})
    try { await probe.connect(); await probe.ping(); return true } catch { return false }
    finally { probe.disconnect() }
}

/** Resolve once a server message matching `pred` arrives (or reject on timeout). */
function waitFor(ws: WebSocket, pred: (msg: any) => boolean, ms = 4000): Promise<any> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { ws.removeEventListener("message", onMsg); reject(new Error("timeout")) }, ms)
        const onMsg = (ev: MessageEvent) => {
            let msg: any
            try { msg = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data)) } catch { return }
            if (pred(msg)) { clearTimeout(timer); ws.removeEventListener("message", onMsg); resolve(msg) }
        }
        ws.addEventListener("message", onMsg)
    })
}

const run = (await redisAvailable()) ? describe : describe.skip

run("native WebSocket realtime", () => {
    let auth: ReturnType<typeof betterAuth>
    let client: ReturnType<typeof createAuthClient>
    let headers: Headers
    let token: string
    // Unique per run — Redis persists counters across test processes.
    const referenceId = `org-realtime-${Date.now()}`
    const feature = "api-calls"

    beforeAll(async () => {
        await resetRuntime()

        auth = betterAuth({
            baseURL: "http://localhost:3000",
            secret: "test-secret-at-least-32-chars-long!!",
            emailAndPassword: { enabled: true },
            rateLimit: { enabled: false },
            advanced: { disableCSRFCheck: true },
            plugins: [
                bearer(),
                usage({
                    features: { [feature]: { maxLimit: 1000, reset: "never", resetValue: 0 } },
                    cacheOptions: { redisUrl: REDIS_URL, enableRealtime: true, port: PORT },
                }) as BetterAuthPlugin,
            ],
        })

        const customFetchImpl = async (url: string | URL | Request, init?: RequestInit) =>
            auth.handler(new Request(url, init))
        client = createAuthClient({ baseURL: "http://localhost:3000/api/auth", fetchOptions: { customFetchImpl } })

        await auth.api.signUpEmail({ body: { email: "rt@test.com", password: "test123456", name: "RT" } })

        headers = new Headers()
        await client.signIn.email({
            email: "rt@test.com",
            password: "test123456",
            fetchOptions: {
                onSuccess(ctx: any) {
                    const h = ctx.response.headers.get("set-cookie")
                    const m = h?.match(/better-auth\.session_token=([^;]+)/)
                    if (m) headers.set("cookie", `better-auth.session_token=${m[1]}`)
                },
            },
        })

        const session = await auth.api.getSession({ headers })
        token = (session as any).session.token

        // Register customer + first request → boots the WS server (lazy on first pipeline run).
        await client.$fetch("/usage/upsert-customer", { method: "POST", body: { referenceId, referenceType: "org" }, headers })
        await client.$fetch("/usage/check", { method: "POST", body: { referenceId, featureKey: feature }, headers })
        // Give the server a tick to bind the port.
        await new Promise((r) => setTimeout(r, 200))
    })

    afterAll(async () => { await resetRuntime() })

    test("/usage/ws reports the realtime endpoint", async () => {
        const res = await client.$fetch("/usage/ws", { method: "GET", headers })
        const info = (res as any).data
        expect(info.enabled).toBe(true)
        expect(info.url).toContain(String(PORT))
    })

    test("subscriber receives a live event when another device consumes", async () => {
        const ws = new WebSocket(`ws://localhost:${PORT}`)
        await new Promise<void>((resolve, reject) => {
            ws.addEventListener("open", () => resolve(), { once: true })
            ws.addEventListener("error", () => reject(new Error("ws error")), { once: true })
        })

        // Auth handshake
        ws.send(JSON.stringify({ t: "auth", token }))
        await waitFor(ws, (m) => m.t === "ready")

        // Subscribe to the room
        ws.send(JSON.stringify({ t: "subscribe", subscriptions: [{ referenceId, feature, referenceType: "org" }] }))
        await waitFor(ws, (m) => m.t === "subscribed")

        // "Other device" consumes via REST → should fan out to our socket
        const eventP = waitFor(ws, (m) => m.t === "event" && m.data?.feature === feature)
        await client.$fetch("/usage/use-feature", {
            method: "POST",
            body: { referenceId, featureKey: feature, amount: 7, event: "use" },
            headers,
        })

        const event = await eventP
        expect(event.data.refId).toBe(referenceId)
        expect(event.data.newTotal).toBe(7)

        ws.close()
    })

    test("rejects messages before auth", async () => {
        const ws = new WebSocket(`ws://localhost:${PORT}`)
        await new Promise<void>((resolve) => ws.addEventListener("open", () => resolve(), { once: true }))

        ws.send(JSON.stringify({ t: "subscribe", subscriptions: [{ referenceId, feature, referenceType: "org" }] }))
        const err = await waitFor(ws, (m) => m.t === "error")
        expect(err.message).toContain("Not authenticated")

        ws.close()
    })
})
