import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import Redis from "ioredis"
import { memoryDriver, redisDriver, type UsageDriver } from "../src/drivers"
import type { CachedUsage, CachedLimits, Customer } from "../src/types"

const REDIS_URL = "redis://localhost:6379"

/** Probe Redis once so the contract block self-skips when it is unreachable. */
async function redisAvailable(): Promise<boolean> {
    const probe = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => null })
    probe.on("error", () => {})
    try {
        await probe.connect()
        await probe.ping()
        return true
    } catch {
        return false
    } finally {
        probe.disconnect()
    }
}

/**
 * Driver contract suite — the executable spec every `UsageDriver` must satisfy.
 *
 * Run identically against every backend. A new driver is "done" when it passes
 * this suite. Tests hit the driver directly (no plugin, no DB) and use unique
 * referenceIds per assertion so backends with shared state (real Redis) stay
 * isolated.
 */

const FEATURE = "api-calls"

let counter = 0
const uniqueRef = (name: string) => `contract-${name}-${++counter}`

const usageRecord = (referenceId: string, current: number, extra?: Partial<CachedUsage>): CachedUsage => ({
    referenceId,
    feature: FEATURE,
    current,
    lastResetAt: null,
    ...extra,
})

const limits = (referenceId: string, extra?: Partial<CachedLimits>): CachedLimits => ({
    referenceId,
    feature: FEATURE,
    ...extra,
})

function contractTests(name: string, makeDriver: () => UsageDriver) {
    describe(`UsageDriver contract: ${name}`, () => {
        let driver: UsageDriver

        beforeAll(() => { driver = makeDriver() })
        afterAll(async () => { await driver.close() })

        test("consume from empty starts at the amount", async () => {
            const ref = uniqueRef("empty")
            const out = await driver.consume({ referenceId: ref, feature: FEATURE, amount: 5, nowMs: Date.now(), event: "use" })
            expect(out.newTotal).toBe(5)
            expect(out.resetOccurred).toBe(false)
        })

        test("consume accumulates across calls", async () => {
            const ref = uniqueRef("accumulate")
            const now = Date.now()
            await driver.consume({ referenceId: ref, feature: FEATURE, amount: 3, nowMs: now, event: "use" })
            const out = await driver.consume({ referenceId: ref, feature: FEATURE, amount: 4, nowMs: now, event: "use" })
            expect(out.newTotal).toBe(7)
        })

        test("getUsage returns null on a cache miss", async () => {
            const ref = uniqueRef("miss")
            expect(await driver.getUsage(ref, FEATURE)).toBeNull()
        })

        test("getUsage reflects the counter after a consume", async () => {
            const ref = uniqueRef("readback")
            await driver.consume({ referenceId: ref, feature: FEATURE, amount: 9, nowMs: Date.now(), event: "use" })
            const cached = await driver.getUsage(ref, FEATURE)
            expect(cached?.current).toBe(9)
        })

        test("hydrate seeds counter + limits", async () => {
            const ref = uniqueRef("hydrate")
            await driver.hydrate(ref, FEATURE, usageRecord(ref, 42), limits(ref, { maxLimit: 100, minLimit: 0 }))
            const cached = await driver.getUsage(ref, FEATURE)
            expect(cached?.current).toBe(42)
            expect(cached?.maxLimit).toBe(100)
            expect(cached?.minLimit).toBe(0)
        })

        test("reset forces the counter to a value", async () => {
            const ref = uniqueRef("reset")
            await driver.consume({ referenceId: ref, feature: FEATURE, amount: 50, nowMs: Date.now(), event: "use" })
            await driver.reset(ref, FEATURE, 0, limits(ref, { lastResetAt: new Date() }))
            const cached = await driver.getUsage(ref, FEATURE)
            expect(cached?.current).toBe(0)
        })

        test("consume crosses a reset boundary", async () => {
            const ref = uniqueRef("boundary")
            const past = new Date(Date.now() - 60_000)
            // Seed a counter with a reset boundary already in the past
            await driver.hydrate(ref, FEATURE, usageRecord(ref, 80), limits(ref, {
                resetValue: 0,
                resetAt: past,
                lastResetAt: new Date(Date.now() - 120_000),
            }))
            const out = await driver.consume({ referenceId: ref, feature: FEATURE, amount: 3, nowMs: Date.now(), event: "use" })
            expect(out.resetOccurred).toBe(true)
            expect(out.newTotal).toBe(3) // reset to resetValue(0), then +3
        })

        test("customer set / get / del", async () => {
            const ref = uniqueRef("customer")
            const customer: Customer = { referenceId: ref, referenceType: "user", email: "c@test.com" }
            await driver.setCustomer(customer)
            const got = await driver.getCustomer(ref)
            expect(got?.referenceId).toBe(ref)
            expect(got?.email).toBe("c@test.com")
            await driver.delCustomer(ref)
            expect(await driver.getCustomer(ref)).toBeNull()
        })

        test("setCustomer clears stale optional fields", async () => {
            const ref = uniqueRef("stale")
            await driver.setCustomer({ referenceId: ref, referenceType: "user", email: "old@test.com", name: "Old" })
            await driver.setCustomer({ referenceId: ref, referenceType: "user" })
            const got = await driver.getCustomer(ref)
            expect(got?.email).toBeUndefined()
            expect(got?.name).toBeUndefined()
        })
    })
}

contractTests("memory", () => memoryDriver())

if (await redisAvailable()) {
    contractTests("redis", () => redisDriver({ redisUrl: REDIS_URL, walEnabled: false }))
} else {
    describe.skip("UsageDriver contract: redis (Redis unreachable — skipped)", () => {
        test("skipped", () => { })
    })
}
