import { Effect } from "effect"
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api"
import { z } from "zod"
import type { UsageOptions } from "@/types"
import { resolveFeature } from "@/pipelines/features"
import { resolveOverrideKey } from "@/pipelines/resolve-override"
import { useFeature } from "@/pipelines/consume"
import { runPipeline } from "@/runtime"

export function getUseFeatureEndpoint(endpointOptions: UsageOptions) {
    return createAuthEndpoint(
        "/usage/use-feature",
        {
            method: "POST",
            middleware: [sessionMiddleware],
            body: z.object({
                featureKey: z.string(),
                overrideKey: z.string().optional(),
                amount: z.number().default(1),
                referenceId: z.string(),
                event: z.string().default("use"),
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

                        return yield* useFeature({
                            referenceId: ctx.body.referenceId,
                            amount: ctx.body.amount,
                            event: ctx.body.event,
                            feature,
                        })
                    })
                )
            } catch (err: any) {
                if (err._tag === "FeatureNotFound") {
                    throw new APIError("NOT_FOUND", { message: `Feature ${err.featureKey} not found` })
                }
                throw new APIError("INTERNAL_SERVER_ERROR", {
                    message: `Failed to use feature: ${err.message ?? err._tag ?? "unknown"}`
                })
            }
        }
    )
}
