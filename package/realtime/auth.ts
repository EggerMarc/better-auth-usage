import { Effect } from "effect"
import type { AuthContext } from "better-auth"
import type { UsageOptions } from "@/types"

/**
 * Validated session result attached to socket.data after handshake.
 */
export interface SocketAuth {
    userId: string
    sessionId: string
}

/**
 * Validate a raw session token against BetterAuth's session store.
 *
 * Looks up the token via `internalAdapter.findSession()`, checks expiration,
 * and returns the user ID + session ID on success.
 */
export const validateSessionToken = (
    token: string,
    authCtx: AuthContext,
): Effect.Effect<SocketAuth, Error> =>
    Effect.tryPromise({
        try: () => authCtx.internalAdapter.findSession(token),
        catch: (cause) => new Error(`Session lookup failed: ${cause}`),
    }).pipe(
        Effect.andThen((result) => {
            if (!result) {
                return Effect.fail(new Error("Invalid session token"))
            }
            if (result.session.expiresAt < new Date()) {
                return Effect.fail(new Error("Session expired"))
            }
            return Effect.succeed({
                userId: result.user.id,
                sessionId: result.session.id,
            })
        }),
    )

/**
 * Lift the `authorizeUser` callback (sync or async) into an Effect.
 * Returns `false` on any error.
 */
export const liftAuthorizeUser = (
    options: UsageOptions,
    params: {
        userId: string
        referenceId: string
        referenceType: string
        feature: string
    },
): Effect.Effect<boolean> => {
    if (!options.authorizeUser) {
        return Effect.succeed(true)
    }
    return Effect.tryPromise(() =>
        Promise.resolve(options.authorizeUser!(params))
    ).pipe(
        Effect.catchAll(() => Effect.succeed(false)),
    )
}
