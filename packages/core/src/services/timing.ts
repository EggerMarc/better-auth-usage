import { Context, Duration, Effect, Option, Ref } from "effect"

interface TimingEntry {
    name: string
    ms: number
}

/**
 * Per-request timing collector behind the `Server-Timing` response header.
 *
 * It is optional on purpose: `timed` looks it up with `Effect.serviceOption`,
 * so pipelines don't require it and nothing is recorded unless `runPipeline`
 * provides one (when `serverTiming` is enabled).
 */
export interface RequestTimings {
    readonly record: (name: string, ms: number) => Effect.Effect<void>
    readonly header: Effect.Effect<string>
}

export const RequestTimings = Context.GenericTag<RequestTimings>("RequestTimings")

/** Server-Timing metric names are HTTP tokens, so keep them to safe chars. */
const toToken = (name: string) => name.replace(/[^A-Za-z0-9_.-]/g, "_")

/**
 * Sum entries with the same name, so `driver.getCustomer` called twice shows
 * as one metric with `desc="2x"` instead of two separate ones.
 */
const formatHeader = (entries: ReadonlyArray<TimingEntry>): string => {
    const grouped = new Map<string, { ms: number; count: number }>()
    for (const { name, ms } of entries) {
        const prev = grouped.get(name) ?? { ms: 0, count: 0 }
        grouped.set(name, { ms: prev.ms + ms, count: prev.count + 1 })
    }
    return [...grouped.entries()]
        .map(([name, { ms, count }]) =>
            `${toToken(name)};${count > 1 ? `desc="${count}x";` : ""}dur=${ms.toFixed(1)}`
        )
        .join(", ")
}

export const makeRequestTimings: Effect.Effect<RequestTimings> = Effect.map(
    Ref.make<ReadonlyArray<TimingEntry>>([]),
    (ref) => ({
        record: (name, ms) => Ref.update(ref, (entries) => [...entries, { name, ms }]),
        header: Effect.map(Ref.get(ref), formatHeader),
    })
)

/**
 * Time `effect` and record it under `name` when a RequestTimings collector is
 * in context. Failed effects aren't recorded.
 */
export const timed = (name: string) => <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.timed(effect).pipe(
        Effect.tap(([duration]) =>
            Effect.serviceOption(RequestTimings).pipe(
                Effect.flatMap(Option.match({
                    onNone: () => Effect.void,
                    onSome: (timings) => timings.record(name, Duration.toMillis(duration)),
                }))
            )
        ),
        Effect.map(([, value]) => value)
    )
