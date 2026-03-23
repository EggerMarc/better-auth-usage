import { Effect } from "effect"
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api"
import { z } from "zod"
import type { UsageOptions } from "@/types"
import { resolveFeature } from "@/pipelines/features"
import { syncUsage } from "@/pipelines/sync"
import { runPipeline } from "@/runtime"

export function getSyncEndpoint(endpointOptions: UsageOptions) {
    return createAuthEndpoint(
        "/usage/sync",
        {
            method: "POST",
            middleware: [sessionMiddleware],
            body: z.object({
                referenceId: z.string(),
                featureKey: z.string(),
                overrideKey: z.string().optional(),
            }),
        },
        async (ctx) => {
            try {
                return await runPipeline(
                    ctx.context,
                    endpointOptions,
                    Effect.gen(function* () {
                        const feature = yield* resolveFeature({
                            featureKey: ctx.body.featureKey,
                            overrideKey: ctx.body.overrideKey,
                            features: endpointOptions.features,
                            overrides: endpointOptions.overrides,
                        })

                        return yield* syncUsage({
                            referenceId: ctx.body.referenceId,
                            feature,
                        })
                    })
                )
            } catch (err: any) {
                if (err._tag === "FeatureNotFound") {
                    throw new APIError("NOT_FOUND", { message: `Feature ${err.featureKey} not found` })
                }
                throw new APIError("INTERNAL_SERVER_ERROR", {
                    message: `Failed to sync usage: ${err.message ?? err._tag ?? "unknown"}`
                })
            }
        }
    )
}
