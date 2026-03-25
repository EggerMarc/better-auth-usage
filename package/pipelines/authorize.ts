import { Effect } from "effect"
import type { ResolvedUsageOptions } from "@/types"
import { NotAuthorized } from "@/errors"

/**
 * Authorization pipeline step.
 *
 * Calls `options.authorizeUser` if configured. If the callback returns false,
 * fails with `NotAuthorized`. If not configured, succeeds (open access).
 */
export const authorizeUser = (
    options: ResolvedUsageOptions,
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
    return Effect.tryPromise({
        try: () => Promise.resolve(options.authorizeUser!(params)),
        catch: (cause) => cause,
    }).pipe(
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
