import { APIError, createAuthMiddleware } from "better-auth/api";
import { resolveFeature } from "package/resolvers/features";
import type { UsageOptions } from "package/types";

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

