import { Effect } from "effect"
import type { UsageOptions } from "@/types"
import { NotAuthorized } from "@/errors"

/**
 * Authorization pipeline step.
 *
 * Calls `options.authorizeUser` if configured. If the callback returns false,
 * fails with `NotAuthorized`. If not configured, succeeds (open access).
 */
export const authorizeUser = (
    options: UsageOptions,
    params: {
        userId: string
        referenceId: string
        referenceType: string
        feature: string
    },
): Effect.Effect<void, NotAuthorized> => {
    if (!options.authorizeUser) {
        return Effect.void
    }
    return Effect.tryPromise(() =>
        Promise.resolve(options.authorizeUser!(params))
    ).pipe(
        Effect.catchAll(() => Effect.succeed(false)),
        Effect.andThen((allowed) =>
            allowed
                ? Effect.void
                : Effect.fail(new NotAuthorized({
                    userId: params.userId,
                    referenceId: params.referenceId,
                    feature: params.feature,
                }))
        ),
    )
}
