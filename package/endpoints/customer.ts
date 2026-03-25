import { Effect } from "effect"
import { createAuthEndpoint, sessionMiddleware } from "better-auth/api"
import { z } from "zod"
import type { ResolvedUsageOptions } from "@/types"
import { getCustomer } from "@/pipelines/get-customer"
import { authorizeUser } from "@/pipelines/authorize"
import { upsertCustomer } from "@/pipelines/customer"
import { runPipeline } from "@/runtime"

export function getUpsertCustomerEndpoint(endpointOptions: ResolvedUsageOptions) {
    return createAuthEndpoint(
        "/usage/upsert-customer",
        {
            method: "POST",
            use: [sessionMiddleware],
            body: z.object({
                referenceId: z.string(),
                referenceType: z.string(),
                email: z.string().optional(),
                name: z.string().optional(),
                overrideKey: z.string().optional(),
            }),
        },
        async (ctx) =>
            runPipeline(ctx.context, endpointOptions, Effect.gen(function* () {
                yield* authorizeUser(endpointOptions, {
                    userId: ctx.context.session.user.id,
                    referenceId: ctx.body.referenceId,
                    referenceType: ctx.body.referenceType,
                    feature: "*",
                })
                return yield* upsertCustomer({
                    customer: {
                        referenceId: ctx.body.referenceId,
                        referenceType: ctx.body.referenceType,
                        email: ctx.body.email,
                        name: ctx.body.name,
                        overrideKey: ctx.body.overrideKey,
                    },
                    features: endpointOptions.features,
                })
            }))
    )
}

export function getCheckCustomerEndpoint(endpointOptions: ResolvedUsageOptions) {
    return createAuthEndpoint(
        "/usage/check-customer",
        {
            method: "POST",
            use: [sessionMiddleware],
            body: z.object({
                referenceId: z.string(),
            }),
        },
        async (ctx) =>
            runPipeline(ctx.context, endpointOptions, Effect.gen(function* () {
                yield* authorizeUser(endpointOptions, {
                    userId: ctx.context.session.user.id,
                    referenceId: ctx.body.referenceId,
                    referenceType: "user",
                    feature: "*",
                })
                return yield* getCustomer(ctx.body.referenceId)
            }))
    )
}
