import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { z } from "zod";
import { resolveFeature } from "package/resolvers/features";
import type { EndpointParams } from "package/types";
import { getUsageAdapter } from "package/adapters";
import { checkLimit, tryCatch } from "package/utils";
import { getUsageMiddleware } from "package/middlewares/usage";
import { resolveGetUsage } from "@/resolvers/get-usage";
import { getCustomerMiddleware } from "@/middlewares/customer";

/**
 * Create an authenticated POST endpoint at /usage/check that validates the request body and verifies a customer's latest usage against a feature's configured limits.
 *
 * @param options - Usage options (features, optional overrides, and cache settings) used to resolve features and control lookup behavior.
 * @returns The configured authenticated endpoint whose response is a status string describing the usage check result.
 */
export function getCheckEndpoint({ options, adapter }: EndpointParams) {
    return createAuthEndpoint(
        "/usage/check",
        {
            method: "POST", // changed to POST so we can rely on body validation consistently
            middleware: [sessionMiddleware, getUsageMiddleware({
                features: options.features,
                overrides: options.overrides
            }), getCustomerMiddleware({ options, adapter })],
            body: z.object({
                referenceId: z.string(),
                featureKey: z.string(),
                overrideKey: z.string().optional(),
                amount: z.number().optional()
            }),
            metadata: {
                openapi: {
                    description: "Checks current usage against feature limits.",
                    requestBody: {
                        required: true,
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        referenceId: { type: "string" },
                                        featureKey: { type: "string" },
                                        overrideKey: { type: "string" },
                                        amount: { type: "string" }
                                    },
                                    required: ["referenceId", "featureKey"],
                                },
                            },
                        },
                    },
                    responses: {
                        200: {
                            description: "Status string",
                        },
                    },
                },
            },
        },
        async (ctx) => {
            const adapter = getUsageAdapter(ctx.context);
            const feature = resolveFeature({
                featureKey: ctx.body.featureKey,
                overrideKey: ctx.body.overrideKey,
                features: options.features,
                overrides: options.overrides
            });

            if (!feature) {
                throw new APIError("NOT_FOUND", { message: "Feature not found" });
            }

            const { data: usage, error } = await tryCatch(
                resolveGetUsage({
                    referenceId: ctx.body.referenceId,
                    adapter, options, feature
                })
            )

            console.log(`[better-auth-usage] got the following usage: ${usage}`)

            if (error) {
                throw new APIError("INTERNAL_SERVER_ERROR", {
                    message: `Internal error getting usage for feature ${feature.key}, ${error.message}`
                })
            }

            return {
                status: checkLimit({
                    minLimit: feature.minLimit,
                    maxLimit: feature.maxLimit,
                    value: usage.amount + (ctx.body.amount ?? 0),
                }),
                maxLimit: feature.maxLimit,
                minLimit: feature.minLimit,
                currentAmount: usage.amount
            };
        }
    )
}
