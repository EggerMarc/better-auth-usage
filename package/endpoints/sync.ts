import { APIError, createAuthEndpoint } from "better-auth/api";
import { resolveSync } from "bun";
import { type UsageEndpoint, getUsageAdapter } from "package/adapter";
import { resolveFeature } from "package/resolvers/features";
import { z } from "zod"

export function getSyncEndpoint({ features, overrides }: UsageEndpoint) {
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

            const usage = resolveSync({ adapter, feature, customer })
            return usage
        }
    )
}
