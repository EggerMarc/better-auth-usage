import { Effect } from "effect"
import { createAuthEndpoint, sessionMiddleware } from "better-auth/api"
import { z } from "zod"
import type { ResolvedUsageOptions } from "../types"
import { resolveFeature } from "../pipelines/features"
import { resolveCustomerAndOverride } from "../pipelines/resolve-override"
import { authorizeUser } from "../pipelines/authorize"
import { useFeature } from "../pipelines/consume"
import { runPipeline } from "../runtime"

export function getUseFeatureEndpoint(endpointOptions: ResolvedUsageOptions) {
    return createAuthEndpoint(
        "/usage/use-feature",
        {
            method: "POST",
            use: [sessionMiddleware],
            body: z.object({
                featureKey: z.string(),
                overrideKey: z.string().optional(),
                amount: z.number().default(1),
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
                const { customer, overrideKey } = yield* resolveCustomerAndOverride({
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
                    customer,
                })
            }))
    )
}
