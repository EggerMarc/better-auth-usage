import { getUsageAdapter } from "@/adapters";
import { resolveGetUsage } from "@/resolvers/get-usage";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { usageMiddleware } from "package/middlewares/usage";
import { resolveFeature } from "package/resolvers/features";
import type { UsageOptionsWithCache } from "package/types";
import { z } from "zod"

/**
 * Create an authenticated POST endpoint at /usage/consume that records metered usage for a feature.
 *
 * @param features - Feature definitions available for consumption
 * @param overrides - Optional override definitions that adjust feature behavior or limits
 * @param tracker - Optional tracker used to obtain current usage before consuming
 * @returns The configured authenticated endpoint that inserts and returns the inserted usage record
 */
export function getConsumeEndpoint(options: UsageOptionsWithCache) {
    return createAuthEndpoint(
        "/usage/consume",
        {
            method: "POST",
            middleware: [
                sessionMiddleware,
                usageMiddleware(options),
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
            const adapter = getUsageAdapter(ctx.context);

            const customer = await adapter.getCustomer({
                referenceId: ctx.body.referenceId,
                cache: options.cache
            });

            if (!customer) {
                throw new APIError("NOT_FOUND", { message: `Customer ${ctx.body.referenceId} not found` });
            }

            const feature = resolveFeature({
                featureKey: ctx.body.featureKey,
                overrideKey: ctx.body.overrideKey,
                features: options.features,
                overrides: options.overrides
            });

            const current = await resolveGetUsage({
                referenceId: ctx.body.referenceId,
                feature,
                options,
                adapter
            })

            if (feature.hooks?.before) {
                await feature.hooks.before({
                    customer,
                    usage: {
                        amount: ctx.body.amount,
                        beforeAmount: current.amount,
                        afterAmount: ctx.body.amount + current.amount
                    },
                    feature,
                });
            }

            const res = await adapter.insertUsage({
                referenceId: customer.referenceId,
                event: ctx.body.event,
                feature: feature,
                amount: ctx.body.amount,
            });

            if (feature.hooks?.after) {
                await feature.hooks.after({
                    customer,
                    feature,
                    usage: {
                        amount: ctx.body.amount,
                        beforeAmount: current.amount,
                        afterAmount: current.amount + ctx.body.amount
                    }
                });
            }

            return res;
        }
    )
}
