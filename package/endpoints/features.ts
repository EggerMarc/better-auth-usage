import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api"
import { resolveFeature } from "@/pipelines/features"
import type { ResolvedUsageOptions } from "@/types"
import { z } from "zod"
import { Effect, Exit } from "effect"

export function getFeaturesEndpoint({ features }: ResolvedUsageOptions) {
    return createAuthEndpoint(
        "/usage/features",
        {
            method: "GET",
            use: [sessionMiddleware],
        },
        async () =>
            Object.values(features).map((f) => ({
                featureKey: f.key,
                details: f.details,
            }))
    )
}

export function getFeatureEndpoint({ features, overrides }: ResolvedUsageOptions) {
    return createAuthEndpoint(
        "/usage/features/:featureKey",
        {
            method: "GET",
            use: [sessionMiddleware],
            query: z.object({
                overrideKey: z.string().optional(),
            }),
        },
        async (ctx) => {
            const exit = Effect.runSyncExit(
                resolveFeature({
                    featureKey: ctx.params.featureKey,
                    overrideKey: ctx.query.overrideKey,
                    features,
                    overrides,
                })
            )

            if (Exit.isFailure(exit)) {
                throw new APIError("NOT_FOUND", {
                    message: `Feature ${ctx.params.featureKey} not found`
                })
            }

            const { hooks, ...serializableFeature } = exit.value
            return { feature: serializableFeature }
        }
    )
}
