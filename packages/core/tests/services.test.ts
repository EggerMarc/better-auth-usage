import { describe, expect, it } from "bun:test"
import { Context, Effect } from "effect"
import { BackgroundService, makeBackgroundServiceLive, RequestTimings, makeRequestTimings, timed } from "../src/services"

const Tag = Context.GenericTag<{ value: string }>("TestTag")

describe("BackgroundService", () => {
    it("hands the effect to waitUntil with the caller's services still provided", async () => {
        const handed: Promise<unknown>[] = []
        let seen: string | null = null

        await Effect.runPromise(
            Effect.flatMap(BackgroundService, (bg) =>
                bg.run(Effect.flatMap(Tag, (t) => Effect.sync(() => { seen = t.value })))
            ).pipe(
                Effect.provideService(Tag, { value: "from-request" }),
                Effect.provide(makeBackgroundServiceLive((p) => handed.push(p))),
            )
        )

        expect(handed).toHaveLength(1)
        await handed[0]
        expect(seen).toBe("from-request")
    })

    it("does not fail the caller when the background effect fails", async () => {
        const handed: Promise<unknown>[] = []
        await Effect.runPromise(
            Effect.flatMap(BackgroundService, (bg) => bg.run(Effect.fail("boom"))).pipe(
                Effect.provide(makeBackgroundServiceLive((p) => handed.push(p))),
            )
        )
        await expect(handed[0]).resolves.toBeUndefined()
    })
})

describe("RequestTimings", () => {
    it("records nothing when no collector is provided", async () => {
        expect(await Effect.runPromise(Effect.succeed(1).pipe(timed("x")))).toBe(1)
    })

    it("groups repeated metrics into one Server-Timing entry", async () => {
        const header = await Effect.runPromise(
            Effect.flatMap(makeRequestTimings, (timings) =>
                Effect.all([
                    Effect.succeed(1).pipe(timed("driver.getCustomer")),
                    Effect.succeed(2).pipe(timed("driver.getCustomer")),
                    Effect.succeed(3).pipe(timed("db.create")),
                ]).pipe(
                    Effect.zipRight(timings.header),
                    Effect.provideService(RequestTimings, timings),
                )
            )
        )
        expect(header).toMatch(/^driver\.getCustomer;desc="2x";dur=\d+\.\d, db\.create;dur=\d+\.\d$/)
    })
})
