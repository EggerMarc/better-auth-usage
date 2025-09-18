import { BetterAuthPlugin, OpenAPIParameter } from "better-auth";
import { UsageOptions } from "./types";
import { createAuthEndpoint } from "better-auth/api";
import { z } from "zod"
import { getUsageAdapter } from "./adapter";
import { checkLimit, shouldReset } from "./utils";

export function usage<O extends UsageOptions>(options: O) {
    const { customers, features, overrides } = options
    return {
        id: "usage",
        schema: {
            usage: {
                fields: {
                    referenceId: {
                        type: "string",
                        required: true,
                        input: true,
                    },
                    referenceType: {
                        type: "string",
                        required: true,
                        input: true,
                    },
                    feature: {
                        type: "string",
                        required: true,
                        input: true,
                    },
                    amount: {
                        type: "number",
                        required: true,
                        input: true,
                    },
                    afterAmount: {
                        type: "number",
                        required: true,
                        input: true,
                    },
                    beforeAmount: {
                        type: "number",
                        required: true,
                        input: true,
                    },
                    event: {
                        type: "string",
                        required: true,
                    },
                    createdAt: {
                        type: "date",
                        required: true,
                    },
                },
            },
        },
        endpoints: {
            checkUsage: createAuthEndpoint(
                "/usage/check",
                {
                    method: "GET",
                    body: z.object({
                        referenceId: z.string({
                            description: "Customer referenceId to look for",
                        }),
                        feature: z.string({
                            description: "Feature to check",
                        }),
                        overrideKey: z
                            .string({
                                description:
                                    "Override usage limits/behaviour (e.g. plan name)",
                            })
                            .optional(),
                    }),
                    metadata: {
                        openapi: {
                            description: "Checks current usage",
                            parameters: [
                                {
                                    in: "query",
                                    name: "feature",
                                    required: true,
                                    description: "Feature key",
                                    schema: { type: "string", example: "token-feature" },
                                } satisfies OpenAPIParameter,
                                {
                                    in: "query",
                                    name: "referenceId",
                                    required: true,
                                    description: "ID of the customer",
                                    schema: { type: "string" },
                                } satisfies OpenAPIParameter,
                            ],
                            responses: {
                                200: {
                                    description: "Success",
                                    content: {
                                        "application/json": {
                                            schema: {
                                                type: "string",
                                                enum: ["in-limit", "above-limit", "below-limit"],
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
                async (ctx) => {
                    // Change later
                    const adapter = getUsageAdapter(ctx.context)
                    const usage = await adapter.findLatestUsage({
                        ...ctx.body
                    })

                    let feature = features[ctx.body.feature]
                    if (!feature) throw new Error(`Feature ${ctx.body.feature} not found`)

                    if (ctx.body.overrideKey && overrides?.[ctx.body.overrideKey]) {
                        feature = {
                            ...feature,
                            ...overrides[ctx.body.overrideKey].features[ctx.body.feature],
                        }
                    }

                    return checkLimit({
                        ...feature,
                        value: usage?.afterAmount ?? 0,
                    })
                }
            ),

            syncUsage: createAuthEndpoint(
                "/usage/sync",
                {
                    method: "POST",
                    body: z.object({
                        referenceId: z.string(),
                        referenceType: z.string(),
                        feature: z.string(),
                        overrideKey: z.string().optional(),
                    }),
                    metadata: {
                        openapi: {
                            description: "Syncs customer usage based on reset rules",
                            parameters: [
                                {
                                    in: "query",
                                    name: "referenceId",
                                    required: true,
                                    description: "ID of the customer",
                                    schema: { type: "string" },
                                } satisfies OpenAPIParameter,
                            ],
                        },
                    },
                },
                async (ctx) => {
                    const adapter = getUsageAdapter(ctx.context);
                    let feature = features[ctx.body.feature];
                    if (!feature) throw new Error(`Feature ${ctx.body.feature} not found`)
                    if (ctx.body.overrideKey && overrides?.[ctx.body.overrideKey]) {
                        feature = {
                            ...feature,
                            ...overrides[ctx.body.overrideKey].features[ctx.body.feature],
                        }
                    }

                    if (!feature.reset || feature.reset === "never") {
                        return
                    }

                    const lastReset = await adapter.findLatestUsage({
                        ...ctx.body,
                        event: "reset"
                    })
                    const resetDue = shouldReset(lastReset.createdAt, feature.reset)
                    if (resetDue) {
                        return await adapter.insertUsage({
                            beforeAmount: 0,
                            afterAmount: 0,
                            amount: 0,
                            feature: feature.key,
                            referenceId: ctx.body.referenceId,
                            referenceType: ctx.body.referenceType,
                            event: "reset"
                        })
                    }
                }
            ),
        },
        features,
        overrides,
        customers, // optional in-memory map for quick lookup
    } satisfies BetterAuthPlugin;
}


