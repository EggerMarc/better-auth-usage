import { Effect } from "effect"
import { createAuthEndpoint, sessionMiddleware } from "better-auth/api"
import { z } from "zod"
import type { ResolvedUsageOptions } from "@/types"
import { resolveFeature } from "@/pipelines/features"
import { resolveOverrideKey } from "@/pipelines/resolve-override"
import { authorizeUser } from "@/pipelines/authorize"
import { checkUsage } from "@/pipelines/check"
import { runPipeline } from "@/runtime"

export function getCheckEndpoint(endpointOptions: ResolvedUsageOptions) {
    return createAuthEndpoint(
        "/usage/check",
        {
            method: "POST",
            use: [sessionMiddleware],
            body: z.object({
                referenceId: z.string(),
                featureKey: z.string(),
                overrideKey: z.string().optional(),
                amount: z.number().optional(),
            }),
        },
        async (ctx) =>
            runPipeline(ctx.context, endpointOptions, Effect.gen(function* () {
                yield* authorizeUser(endpointOptions, {
                    userId: ctx.context.session.user.id,
                    referenceId: ctx.body.referenceId,
                    referenceType: "user",
                    feature: ctx.body.featureKey,
                })
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
            }))
    )
}
