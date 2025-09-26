import { APIError, createAuthEndpoint } from "better-auth/api";
import { getUsageAdapter } from "package/adapter";
import { resolveFeature } from "package/resolvers/features";
import { resolveSyncUsage } from "package/resolvers/sync-usage";
import type { UsageOptions } from "package/types";
import { z } from "zod"

/**
 * Create an authenticated POST endpoint at /usage/sync that synchronizes a customer's usage according to reset rules.
 *
 * The endpoint validates a JSON body containing `referenceId`, `featureKey`, and optional `overrideKey`, looks up the customer,
 * resolves the feature (considering provided features and overrides), and returns the resolved sync usage. If the customer is not found,
 * the endpoint responds with a 404 error.
 *
 * @param options - Configuration containing available features and overrides used to resolve the feature for sync
 * @returns The configured authenticated endpoint for syncing customer usage; responds with the resolved usage value or a 404 when the customer is not found
 */
export function getSyncEndpoint({ features, overrides }: UsageOptions) {
    return createAuthEndpoint(
        "/usage/sync",
        {
            method: "POST",
            body: z.object({
                referenceId: z.string(),
                featureKey: z.string(),
                overrideKey: z.string().optional(),
            }),
            metadata: {
                openapi: {
                    description: "Syncs customer usage based on reset rules (inserts a reset row if due).",
                    requestBody: {
                        required: true,
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        referenceId: { type: "string" },
                                        featureKey: { type: "string" },
                                    },
                                    required: ["referenceId", "featureKey"],
                                },
                            },
                        },
                    },
                    responses: {
                        200: { description: "Reset inserted or not needed" },
                        404: { description: "Customer or feature not found" },
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

            const usage = await resolveSyncUsage({ adapter, feature, customer })
            return usage
        }
    )
}
