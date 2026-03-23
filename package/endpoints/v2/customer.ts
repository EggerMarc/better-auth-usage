import { Effect } from "effect"
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api"
import { z } from "zod"
import type { UsageOptions } from "@/types"
import { getCustomer } from "@/pipelines/get-customer"
import { upsertCustomer } from "@/pipelines/customer"
import { runPipeline } from "@/runtime"
import { redactId } from "@/utils"

export function getUpsertCustomerEndpoint(endpointOptions: UsageOptions) {
    return createAuthEndpoint(
        "/usage/upsert-customer",
        {
            method: "POST",
            middleware: [sessionMiddleware],
            body: z.object({
                referenceId: z.string(),
                referenceType: z.string(),
                email: z.string().optional(),
                name: z.string().optional(),
                overrideKey: z.string().optional(),
            }),
        },
        async (ctx) => {
            try {
                return await runPipeline(
                    ctx.context,
                    endpointOptions,
                    upsertCustomer({
                        customer: {
                            referenceId: ctx.body.referenceId,
                            referenceType: ctx.body.referenceType,
                            email: ctx.body.email,
                            name: ctx.body.name,
                            overrideKey: ctx.body.overrideKey,
                        },
                        features: endpointOptions.features,
                    })
                )
            } catch (err: any) {
                throw new APIError("INTERNAL_SERVER_ERROR", {
                    message: `Failed to upsert customer ${redactId(ctx.body.referenceId)}: ${err.message ?? err._tag ?? "unknown"}`
                })
            }
        }
    )
}

export function getCheckCustomerEndpoint(endpointOptions: UsageOptions) {
    return createAuthEndpoint(
        "/usage/check-customer",
        {
            method: "POST",
            middleware: [sessionMiddleware],
            body: z.object({
                referenceId: z.string(),
            }),
        },
        async (ctx) => {
            try {
                return await runPipeline(
                    ctx.context,
                    endpointOptions,
                    getCustomer(ctx.body.referenceId)
                )
            } catch (err: any) {
                if (err._tag === "CustomerNotFound") {
                    throw new APIError("NOT_FOUND", {
                        message: `Customer ${redactId(ctx.body.referenceId)} not found`
                    })
                }
                throw new APIError("INTERNAL_SERVER_ERROR", {
                    message: `Failed to check customer: ${err.message ?? err._tag ?? "unknown"}`
                })
            }
        }
    )
}
