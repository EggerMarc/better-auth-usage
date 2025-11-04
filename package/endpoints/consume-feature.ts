import { getUsageAdapter } from "@/adapters";
import { getCustomerMiddleware } from "@/middlewares/customer";
import { getUsageMiddleware } from "@/middlewares/usage";
import { resolveInsertUsage } from "@/resolvers/insert-usage";
import { getUsageOptions } from "@/resolvers/options";
import { tryCatch } from "@/utils";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { resolveFeature } from "package/resolvers/features";
import type { EndpointParams, UsageOptions } from "package/types";
import { z } from "zod"

/**
 * Create an authenticated POST endpoint at /usage/consume that records metered usage for a feature.
 *
 * @param options - Runtime options used by the endpoint, including feature definitions, override configurations, adapter selection, and caching behavior
 * @returns The configured authenticated endpoint that inserts a usage record and returns the inserted usage data
 */
export function getConsumeEndpoint(endpointOptions: UsageOptions) {
    return createAuthEndpoint(
        "/usage/consume",
        {
            method: "POST",
            middleware: [
                sessionMiddleware,
                //getUsageMiddleware({ ...options }),
                //getCustomerMiddleware({ options, adapter })
            ],
            body: z.object({
                featureKey: z.string(),
                overrideKey: z.string().optional(),
                amount: z.number(),
                referenceId: z.string(),
                event: z.string().default("use"),
            }),
            metadata: {
                openapi: {
                    description: "Consume a feature (meter usage).",
                    requestBody: {
                        required: true,
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        featureKey: { type: "string", description: "Feature Key" },
                                        overrideKey: { type: "string", description: "Overriding Key for consumption limits" },
                                        amount: { type: "number", description: "Amount to be consumed" },
                                        referenceId: { type: "string", description: "Reference ID of the customer" },
                                        event: { type: "string", description: "(Optional) Event tag of the consumption" },
                                    },
                                    required: ["featureKey", "amount", "referenceId"],
                                },
                            },
                        },
                    },
                    responses: {
                        200: {
                            description: "Usage row inserted",
                            content: { "application/json": { schema: { type: "object" } } },
                        },
                        404: { description: "Customer or feature not found" },
                        401: { description: "Unauthorized" },
                    },
                },
            },
        },
        async (ctx) => {
            const { options, adapter } = await getUsageOptions({
                ctx: ctx.context, options: endpointOptions
            });
            const feature = resolveFeature({
                featureKey: ctx.body.featureKey,
                overrideKey: ctx.body.overrideKey,
                features: options.features,
                overrides: options.overrides
            });

            const { data, error } = await tryCatch(
                resolveInsertUsage({
                    referenceId: ctx.body.referenceId,
                    amount: ctx.body.amount,
                    event: ctx.body.event,
                    feature,
                    adapter,
                    options
                })
            );
            if (error || !data) {
                throw new APIError("INTERNAL_SERVER_ERROR", {
                    message: `Failed to sync usage on feature ${feature.key}\n${error ? error.message : 'data not found'}`
                })
            }
            return data;
        }
    )
}
