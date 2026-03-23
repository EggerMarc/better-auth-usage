import { Effect } from "effect"
import { createAuthEndpoint, sessionMiddleware } from "better-auth/api"
import { z } from "zod"
import type { UsageOptions } from "@/types"
import { resolveFeature } from "@/pipelines/features"
import { resolveOverrideKey } from "@/pipelines/resolve-override"
import { canUse } from "@/pipelines/check"
import { runPipeline } from "@/runtime"

export function getCanUseEndpoint(endpointOptions: UsageOptions) {
    return createAuthEndpoint(
        "/usage/can-use",
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
        async (ctx) =>
            runPipeline(ctx.context, endpointOptions, Effect.gen(function* () {
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
                return yield* canUse({
                    referenceId: ctx.body.referenceId,
                    feature,
                    amount: ctx.body.amount,
                })
            }))
    )
}
