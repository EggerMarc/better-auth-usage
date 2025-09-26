import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { getUsageAdapter } from "package/adapter";
import { usageMiddleware } from "package/middlewares/usage";
import { resolveFeature } from "package/resolvers/features";
import type { UsageOptions } from "package/types";
import { z } from "zod"

export function getConsumeEndpoint({
    features, overrides
}: UsageOptions) {
    return createAuthEndpoint(
        "/usage/consume",
        {
            method: "POST",
            middleware: [sessionMiddleware, usageMiddleware],
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
                referenceId: ctx.body.referenceId
            });

            if (!customer) {
                throw new APIError("NOT_FOUND", { message: `Customer ${ctx.body.referenceId} not found` });
            }

            const feature = resolveFeature({
                featureKey: ctx.body.featureKey,
                overrideKey: ctx.body.overrideKey,
                features,
                overrides
            });

            const lastUsage = await adapter.findLatestUsage({
                referenceId: customer.referenceId,
                featureKey: feature.key,
            });

            const beforeAmount = lastUsage?.afterAmount ?? 0;
            const afterAmount = beforeAmount + ctx.body.amount;
            if (feature.hooks?.before) {
                await feature.hooks.before({
                    customer,
                    usage: {
                        amount: ctx.body.amount,
                        beforeAmount,
                        afterAmount,
                    },
                    feature,
                });
            }

            const res = await adapter.insertUsage({
                referenceType: customer.referenceType,
                referenceId: customer.referenceId,
                event: ctx.body.event,
                feature: feature,
                amount: ctx.body.amount,
            });

            if (feature.hooks?.after) {
                await feature.hooks.after({
                    customer,
                    usage: {
                        amount: ctx.body.amount,
                        beforeAmount,
                        afterAmount,
                    },
                    feature,
                });
            }

            return res;
        }
    )
}
