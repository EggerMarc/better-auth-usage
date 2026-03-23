import { Effect } from "effect"
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api"
import { z } from "zod"
import type { UsageOptions } from "@/types"
import { resolveFeature } from "@/pipelines/features"
import { resolveOverrideKey } from "@/pipelines/resolve-override"
import { checkUsage } from "@/pipelines/check"
import { runPipeline } from "@/runtime"

export function getCheckEndpoint(endpointOptions: UsageOptions) {
    return createAuthEndpoint(
        "/usage/check",
        {
            method: "POST",
            middleware: [sessionMiddleware],
            body: z.object({
                referenceId: z.string(),
                featureKey: z.string(),
                overrideKey: z.string().optional(),
                amount: z.number().optional(),
            }),
        },
        async (ctx) => {
            try {
                return await runPipeline(
                    ctx.context,
                    endpointOptions,
                    Effect.gen(function* () {
                        const overrideKey = yield* resolveOverrideKey({
                            overrideKey: ctx.body.overrideKey,
                            referenceId: ctx.body.referenceId,
                        })

                        const feature = yield* resolveFeature({
                            featureKey: ctx.body.featureKey,
                            overrideKey,
                            features: endpointOptions.features,
                            overrides: endpointOptions.overrides,
                        })

                        return yield* checkUsage({
                            referenceId: ctx.body.referenceId,
                            feature,
                            amount: ctx.body.amount,
                        })
                    })
                )
            } catch (err: any) {
                if (err._tag === "FeatureNotFound") {
                    throw new APIError("NOT_FOUND", { message: `Feature ${err.featureKey} not found` })
                }
                throw new APIError("INTERNAL_SERVER_ERROR", {
                    message: `Failed to check usage: ${err.message ?? err._tag ?? "unknown"}`
                })
            }
        }
    )
}
