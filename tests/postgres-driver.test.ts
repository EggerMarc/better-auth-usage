import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { Client } from "pg"
import { postgresDriver } from "../package/drivers/postgres"
import type { UsageDriver } from "../package/drivers"
import type { CachedUsage, CachedLimits, Customer } from "../package/types"

const PG_URL = process.env.PG_TEST_URL ?? "postgres://postgres:test@localhost:5433/bau"
const FEATURE = "api-calls"

async function pgAvailable(): Promise<boolean> {
    const c = new Client(PG_URL)
    try { await c.connect(); await c.query("SELECT 1"); return true } catch { return false }
    finally { await c.end().catch(() => {}) }
}

let counter = 0
// Per-run token — Postgres persists rows across test processes.
const RUN = Date.now()
const uniqueRef = (name: string) => `pg-${name}-${RUN}-${++counter}`
const usageRecord = (referenceId: string, current: number, extra?: Partial<CachedUsage>): CachedUsage =>
    ({ referenceId, feature: FEATURE, current, lastResetAt: null, ...extra })
const limits = (referenceId: string, extra?: Partial<CachedLimits>): CachedLimits =>
    ({ referenceId, feature: FEATURE, ...extra })

const run = (await pgAvailable()) ? describe : describe.skip

run("UsageDriver contract: postgres", () => {
    let driver: UsageDriver
    beforeAll(() => { driver = postgresDriver({ connectionString: PG_URL }) })
    afterAll(async () => { await driver.close() })

    test("consume from empty starts at the amount", async () => {
        const ref = uniqueRef("empty")
        const out = await driver.consume({ referenceId: ref, feature: FEATURE, amount: 5, nowMs: Date.now(), event: "use" })
        expect(out.newTotal).toBe(5)
        expect(out.resetOccurred).toBe(false)
    })

    test("consume accumulates", async () => {
        const ref = uniqueRef("acc")
        const now = Date.now()
        await driver.consume({ referenceId: ref, feature: FEATURE, amount: 3, nowMs: now, event: "use" })
        const out = await driver.consume({ referenceId: ref, feature: FEATURE, amount: 4, nowMs: now, event: "use" })
        expect(out.newTotal).toBe(7)
    })

    test("getUsage miss → null, then reflects the counter", async () => {
        const ref = uniqueRef("miss")
        expect(await driver.getUsage(ref, FEATURE)).toBeNull()
        await driver.consume({ referenceId: ref, feature: FEATURE, amount: 9, nowMs: Date.now(), event: "use" })
        expect((await driver.getUsage(ref, FEATURE))?.current).toBe(9)
    })

    test("hydrate seeds counter + limits", async () => {
        const ref = uniqueRef("hydrate")
        await driver.hydrate(ref, FEATURE, usageRecord(ref, 42), limits(ref, { maxLimit: 100, minLimit: 0 }))
        const cached = await driver.getUsage(ref, FEATURE)
        expect(cached?.current).toBe(42)
        expect(cached?.maxLimit).toBe(100)
    })

    test("reset forces the counter", async () => {
        const ref = uniqueRef("reset")
        await driver.consume({ referenceId: ref, feature: FEATURE, amount: 50, nowMs: Date.now(), event: "use" })
        await driver.reset(ref, FEATURE, 0, limits(ref, { lastResetAt: new Date() }))
        expect((await driver.getUsage(ref, FEATURE))?.current).toBe(0)
    })

    test("consume crosses a reset boundary", async () => {
        const ref = uniqueRef("boundary")
        const past = new Date(Date.now() - 60_000)
        await driver.hydrate(ref, FEATURE, usageRecord(ref, 80), limits(ref, {
            resetValue: 0, resetAt: past, lastResetAt: new Date(Date.now() - 120_000),
        }))
        const out = await driver.consume({ referenceId: ref, feature: FEATURE, amount: 3, nowMs: Date.now(), event: "use" })
        expect(out.resetOccurred).toBe(true)
        expect(out.newTotal).toBe(3)
    })

    test("customer set / get / del + stale-field clear", async () => {
        const ref = uniqueRef("customer")
        const customer: Customer = { referenceId: ref, referenceType: "org", email: "c@test.com", name: "C" }
        await driver.setCustomer(customer)
        expect((await driver.getCustomer(ref))?.email).toBe("c@test.com")
        await driver.setCustomer({ referenceId: ref, referenceType: "org" })
        const got = await driver.getCustomer(ref)
        expect(got?.email).toBeUndefined()
        expect(got?.name).toBeUndefined()
        await driver.delCustomer(ref)
        expect(await driver.getCustomer(ref)).toBeNull()
    })

    test("LISTEN/NOTIFY delivers a realtime event on consume", async () => {
        const ref = uniqueRef("notify")
        const events: any[] = []
        const unsub = await driver.realtime!.onUsageEvent((e) => events.push(e))
        // small delay to ensure LISTEN is active
        await new Promise((r) => setTimeout(r, 150))
        await driver.consume({ referenceId: ref, feature: FEATURE, amount: 11, nowMs: Date.now(), event: "use" })
        await new Promise((r) => setTimeout(r, 300))
        unsub()
        const match = events.find((e) => e.refId === ref)
        expect(match?.newTotal).toBe(11)
    })
})
