import { Effect } from "effect"
import { createAuthEndpoint, sessionMiddleware } from "better-auth/api"
import { z } from "zod"
import type { ResolvedUsageOptions } from "../types"
import { resolveFeature } from "../pipelines/features"
import { resolveOverrideKey } from "../pipelines/resolve-override"
import { authorizeUser } from "../pipelines/authorize"
import { consumeUsage } from "../pipelines/consume"
import { runPipeline } from "../runtime"

export function getConsumeEndpoint(endpointOptions: ResolvedUsageOptions) {
    return createAuthEndpoint(
        "/usage/consume",
        {
            method: "POST",
            use: [sessionMiddleware],
            body: z.object({
                featureKey: z.string(),
                overrideKey: z.string().optional(),
                amount: z.number(),
                referenceId: z.string(),
                event: z.string().default("use"),
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
                return yield* consumeUsage({
                    referenceId: ctx.body.referenceId,
                    amount: ctx.body.amount,
                    event: ctx.body.event,
                    feature,
                })
            }))
    )
}
