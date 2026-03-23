import { createAuthEndpoint, sessionMiddleware } from "better-auth/api"
import { resolveFeature } from "@/pipelines/features"
import type { UsageOptions } from "@/types"
import { z } from "zod"
import { Effect } from "effect"

export function getFeaturesEndpoint({ features }: UsageOptions) {
    return createAuthEndpoint(
        "/usage/features",
        {
            method: "GET",
            middleware: [sessionMiddleware],
        },
        async () => {
            return Object.values(features).map((f) => ({
                featureKey: f.key,
                details: f.details,
            }))
        }
    )
}

export function getFeatureEndpoint({ features, overrides }: UsageOptions) {
    return createAuthEndpoint(
        "/usage/features/:featureKey",
        {
            method: "GET",
            middleware: [sessionMiddleware],
            body: z.object({
                overrideKey: z.string().optional(),
            }),
        },
        async (ctx) => {
            const result = Effect.runSync(
                resolveFeature({
                    featureKey: ctx.params.featureKey,
                    overrideKey: ctx.body.overrideKey,
                    features,
                    overrides,
                })
            )
            const serializableFeature = { ...result }
            delete (serializableFeature as any).hooks
            return { feature: serializableFeature }
        }
    )
}
