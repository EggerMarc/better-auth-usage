import { describe, test, expect, beforeEach } from "bun:test"
import { UsageStore, type DOStorageLike } from "../package/drivers/cloudflare/object"
import type { CachedUsage, CachedLimits } from "../package/types"

/**
 * Unit test for the Durable Object's pure store logic (atomic counter + reset).
 * Runs against a Map-backed fake of DO storage — no workerd needed. The live
 * Hibernatable-WebSocket fan-out is covered by the protocol/realtime tests.
 */

function fakeStorage(): DOStorageLike {
    const m = new Map<string, unknown>()
    return {
        get: async <T>(k: string) => m.get(k) as T | undefined,
        put: async (k, v) => { m.set(k, v) },
        delete: async (k) => m.delete(k),
    }
}

const FEATURE = "api-calls"
const REF = "org-do"
const now = () => 1_700_000_000_000

describe("UsageDurableObject store", () => {
    let store: UsageStore

    beforeEach(() => { store = new UsageStore(fakeStorage()) })

    test("consume from empty starts at the amount", async () => {
        const out = await store.consume({ referenceId: REF, feature: FEATURE, amount: 5, nowMs: now(), event: "use" })
        expect(out.newTotal).toBe(5)
        expect(out.resetOccurred).toBe(false)
    })

    test("consume accumulates", async () => {
        await store.consume({ referenceId: REF, feature: FEATURE, amount: 3, nowMs: now(), event: "use" })
        const out = await store.consume({ referenceId: REF, feature: FEATURE, amount: 4, nowMs: now(), event: "use" })
        expect(out.newTotal).toBe(7)
    })

    test("getUsage miss → null, then reflects the counter", async () => {
        expect(await store.getUsage(REF, FEATURE)).toBeNull()
        await store.consume({ referenceId: REF, feature: FEATURE, amount: 9, nowMs: now(), event: "use" })
        expect((await store.getUsage(REF, FEATURE))?.current).toBe(9)
    })

    test("hydrate seeds counter + limits", async () => {
        const usage: CachedUsage = { referenceId: REF, feature: FEATURE, current: 42, lastResetAt: null, maxLimit: 100, minLimit: 0 }
        const meta: CachedLimits = { referenceId: REF, feature: FEATURE, maxLimit: 100, minLimit: 0 }
        await store.hydrate(FEATURE, usage, meta)
        const cached = await store.getUsage(REF, FEATURE)
        expect(cached?.current).toBe(42)
        expect(cached?.maxLimit).toBe(100)
    })

    test("reset forces the counter", async () => {
        await store.consume({ referenceId: REF, feature: FEATURE, amount: 50, nowMs: now(), event: "use" })
        await store.reset(FEATURE, 0, { lastResetAt: new Date(now()) })
        expect((await store.getUsage(REF, FEATURE))?.current).toBe(0)
    })

    test("consume crosses a reset boundary", async () => {
        const past = now() - 60_000
        await store.hydrate(
            FEATURE,
            { referenceId: REF, feature: FEATURE, current: 80, lastResetAt: null },
            { referenceId: REF, feature: FEATURE, resetValue: 0, resetAt: new Date(past), lastResetAt: new Date(past - 60_000) },
        )
        const out = await store.consume({ referenceId: REF, feature: FEATURE, amount: 3, nowMs: now(), event: "use" })
        expect(out.resetOccurred).toBe(true)
        expect(out.newTotal).toBe(3)
    })

    test("customer set / get / del", async () => {
        await store.setCustomer({ referenceId: REF, referenceType: "org", email: "c@test.com" })
        expect((await store.getCustomer())?.email).toBe("c@test.com")
        await store.delCustomer()
        expect(await store.getCustomer()).toBeNull()
    })
})
