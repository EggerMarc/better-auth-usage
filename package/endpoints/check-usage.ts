import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { z } from "zod";
import { resolveFeature } from "package/resolvers/features";
import type { UsageOptionsWithCache } from "package/types";
import { getUsageAdapter } from "package/adapters";
import { checkLimit } from "package/utils";
import { usageMiddleware } from "package/middlewares/usage";
import { resolveGetCustomer } from "package/resolvers/get-customer"
import { resolveGetUsage } from "@/resolvers/get-usage";
/**
 * Creates an authenticated POST endpoint at /usage/check that validates the request body and checks a customer's latest usage against a feature's configured limits.
 *
 * @param features - Feature definitions available for lookup and limit evaluation.
 * @param overrides - Optional override definitions that can alter or extend feature definitions.
 * @returns The configured authenticated endpoint which responds with a status string describing the usage check result.
 */
export function getCheckEndpoint(options: UsageOptionsWithCache) {
    return createAuthEndpoint(
        "/usage/check",
        {
            method: "POST", // changed to POST so we can rely on body validation consistently
            middleware: [sessionMiddleware, usageMiddleware],
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
            const customer = resolveGetCustomer({
                referenceId: ctx.body.referenceId,
                adapter,
                options
            });

            if (!customer) {
                throw new APIError("NOT_FOUND", { message: `Customer ${ctx.body.referenceId} not found` })
            };

            const feature = resolveFeature({
                featureKey: ctx.body.featureKey,
                overrideKey: ctx.body.overrideKey,
                features: options.features,
                overrides: options.overrides
            });

            if (!feature) {
                throw new APIError("NOT_FOUND", { message: "Feature not found" });
            }

            const usage = await resolveGetUsage({
                referenceId: ctx.body.referenceId,
                adapter, options, feature
            })

            return checkLimit({
                minLimit: feature.minLimit,
                maxLimit: feature.maxLimit,
                value: usage.amount + (ctx.body.amount ?? 0),
            });
        }
    )
}
