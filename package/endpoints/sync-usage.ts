import { resolveGetCustomer } from "@/resolvers/get-customer";
import { tryCatch } from "@/utils";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { getUsageAdapter } from "package/adapters";
import { resolveFeature } from "package/resolvers/features";
import { resolveSyncUsage } from "package/resolvers/sync-usage";
import type { UsageOptionsWithCache } from "package/types";
import { z } from "zod"

/**
 * Create an authenticated POST endpoint at /usage/sync that synchronizes a customer's usage according to reset rules.
 *
 * @param options - Configuration containing available features, overrides, and cache used to resolve the feature and perform the sync
 * @returns The authenticated endpoint that returns the synchronized usage record for the provided `referenceId` and `featureKey`
 */
export function getSyncEndpoint(options: UsageOptionsWithCache) {
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
            const feature = resolveFeature({
                featureKey: ctx.body.featureKey,
                overrideKey: ctx.body.overrideKey,
                features: options.features,
                overrides: options.overrides
            });

            const { data: usage, error } = await tryCatch(resolveSyncUsage({ adapter, feature, referenceId: ctx.body.referenceId, options }))
            if (error || !usage) {
                throw new APIError("INTERNAL_SERVER_ERROR", {
                    message: `Failed to sync usage on feature ${feature.key}, ${error ? error.message : 'usage not synched'}`
                })
            }
            return usage
        }
    )
}