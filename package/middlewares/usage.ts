import { APIError, createAuthMiddleware } from "better-auth/api";
import { resolveFeature } from "package/resolvers/features";
import type { UsageOptions } from "package/types";

/**
 * Creates an authentication middleware that authorizes a reference against a resolved feature.
 *
 * @param options - Configuration for the middleware
 * @param options.features - Registered features used when resolving the feature referenced by the request
 * @param options.overrides - Overrides that can alter feature resolution
 * @returns A middleware function that, when `ctx.body.referenceId` and `ctx.body.featureKey` are present, resolves the feature and enforces its `authorizeReference` check.
 * @throws APIError with type `"UNAUTHORIZED"` if the resolved feature's `authorizeReference` returns `false`
 */
export function usageMiddleware({ features, overrides }: UsageOptions) {
    return createAuthMiddleware(async (ctx) => {
        if (ctx.body?.referenceId && ctx.body?.featureKey) {
            const feature = resolveFeature({
                featureKey: ctx.body.featureKey,
                overrideKey: ctx.body.overrideKey,
                features,
                overrides
            })
            const isAuthorized = (await feature.authorizeReference?.({
                ...ctx.body,
            })) ?? true;
            if (!isAuthorized) {
                throw new APIError("UNAUTHORIZED", {
                    message: `Customer unauthorized by feature ${feature.key}`,
                });
            }
        }
    })
}

