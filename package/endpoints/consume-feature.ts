import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { getUsageAdapter } from "package/adapters";
import { usageMiddleware } from "package/middlewares/usage";
import { resolveFeature } from "package/resolvers/features";
import type { UsageOptionsWithCache } from "package/types";
import { z } from "zod"

/**
 * Create an authenticated POST endpoint at /usage/consume that records meter usage for a feature.
 *
 * The endpoint validates the request body, resolves the target feature (including any override),
 * looks up the customer by referenceId, invokes optional feature hooks (before/after), and inserts a usage record.
 *
 * @param features - Feature definitions available for consumption
 * @param overrides - Optional override definitions that adjust feature behavior or limits
 * @param cache - Optional cache used by the endpoint for feature/usage lookups
 * @param tracker - Optional tracker that provides current usage for a feature; when present, its data is used instead of querying the adapter for current usage
 * @returns The inserted usage record
 */
export function getConsumeEndpoint({
    features, overrides, cache, tracker
}: UsageOptionsWithCache) {
    return createAuthEndpoint(
        "/usage/consume",
        {
            method: "POST",
            middleware: [
                sessionMiddleware,
                usageMiddleware({ features, overrides }),
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

            let current = null;
            if (tracker) {
                const trackerData = await tracker.getUsage(feature.key, customer?.referenceId);
                current = trackerData.current
            } else {
                const dbData = await adapter.getUsage({
                    referenceId: customer.referenceId,
                    feature
                })
                current = dbData?.amount
            }


            if (feature.hooks?.before) {
                await feature.hooks.before({
                    customer,
                    usage: {
                        amount: ctx.body.amount,
                        beforeAmount: current,
                        afterAmount: ctx.body.amount + current
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
                    usage: {
                        amount: ctx.body.amount,
                    },
                    feature,
                });
            }

            return res;
        }
    )
}