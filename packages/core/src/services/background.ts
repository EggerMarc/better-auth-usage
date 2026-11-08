import { Context, Effect, Layer, Runtime } from "effect"

/**
 * Hands a promise to the platform so it keeps running after the response is
 * sent, e.g. Cloudflare's `waitUntil` from `cloudflare:workers`.
 */
export type WaitUntil = (promise: Promise<unknown>) => void

/**
 * BackgroundService runs work off the request's hot path (history writes,
 * cache backfills) without making the caller wait for it.
 *
 * `run` captures the caller's runtime, so the background effect keeps every
 * service the request had (DbService, LoggerService, ...). Failures are
 * swallowed here, so callers should log their own errors before handing off.
 */
export interface BackgroundService {
    readonly run: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<void, never, R>
}

export const BackgroundService = Context.GenericTag<BackgroundService>("BackgroundService")

/**
 * With `waitUntil`, the effect runs as a promise the platform keeps alive past
 * the response (required on Workers, where a detached fiber can be frozen once
 * the response is returned). Without it, the effect is forked as a daemon
 * fiber, which is enough on long-lived runtimes like Node and bun.
 */
export const makeBackgroundServiceLive = (waitUntil?: WaitUntil): Layer.Layer<BackgroundService> =>
    Layer.succeed(BackgroundService, {
        run: <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<void, never, R> => {
            const safe = effect.pipe(Effect.catchAllCause(() => Effect.void), Effect.asVoid)
            if (!waitUntil) return Effect.asVoid(Effect.forkDaemon(safe))
            return Effect.flatMap(Effect.runtime<R>(), (runtime) =>
                Effect.sync(() => waitUntil(Runtime.runPromise(runtime)(safe)))
            )
        },
    })
