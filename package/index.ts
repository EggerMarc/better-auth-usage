import { APIError, BetterAuthPlugin, OpenAPIParameter } from "better-auth";
import { Customer, UsageOptions } from "./types";
import { createAuthEndpoint, createAuthMiddleware } from "better-auth/api";
import { z } from "zod"
import { getUsageAdapter } from "./adapter";
import { checkLimit, getCustomer, getFeature, shouldReset } from "./utils";
import { customerSchema } from "./schema";
import { getAdapter } from "better-auth/db";

export function usage<O extends UsageOptions>(options: O) {
    const { customers: initCustomers, features, overrides } = options
    const customers = initCustomers ? initCustomers : {} as Record<string, Customer>;

    const middleware = createAuthMiddleware(async (ctx) => {
        const session = ctx.context.session;
        if (!session) {
            throw new APIError("UNAUTHORIZED", {
                message: "Session not found"
            });
        }
        if (ctx.body?.referenceId && ctx.body?.feature) {
            const feature = getFeature({
                features, overrides,
                ...ctx.body
            })
            const customer = customers[ctx.body.referenceId];

            if (!customer) {
                throw new APIError("NOT_FOUND", {
                    message: "Customer not found. Make sure to register them first."
                })
            }

            const isAuthorized = await feature.authorizeReference?.({
                ...ctx.body,
                customer
            }) ?? true

            if (!isAuthorized) {
                throw new APIError("UNAUTHORIZED", {
                    message: `Customer unauthorized by feature ${feature.key}`,
                });
            }
        }
    })

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
            getFeature: createAuthEndpoint("/usage/feature", {
                method: "GET",
                middleware: [middleware],
                body: z.object({
                    featureKey: z.string(),
                    overrideKey: z.string()
                }),
                metadata: {},
            },
                async (ctx) => {
                    const feature = getFeature({
                        features, overrides, ...ctx.body
                    })

                    return {
                        name: feature.key,
                        // feature simple object 
                    }
                }),

            registerCustomer: createAuthEndpoint("/usage/register-customer", {
                method: "POST",
                body: customerSchema,
                metadata: {}
            }, async (ctx) => {
                customers[ctx.body.referenceId] = ctx.body
            }),

            consumeFeature: createAuthEndpoint("/usage/consume", {
                method: "POST",
                middleware: [middleware],
                body: z.object({
                    featureKey: z.string(),
                    overrideKey: z.string(),
                    amount: z.number(),
                    referenceId: z.string(),
                    event: z.string().default("use")
                })
            }, async (ctx) => {
                const adapter = getUsageAdapter(ctx.context)
                const customer = getCustomer({ customers, ...ctx.body });
                const feature = getFeature({ features, overrides, ...ctx.body });
                const lastUsage = await adapter.findLatestUsage({
                    referenceId: customer.referenceId,
                    featureKey: feature.key
                })

                feature.hooks?.before?.({
                    customer, usage: {
                        amount: ctx.body.amount,
                        beforeAmount: lastUsage.afterAmount,
                        afterAmount: lastUsage.afterAmount + ctx.body.amount
                    },
                    feature
                })

                const res = await adapter.insertUsage({
                    ...customer,
                    event: ctx.body.event,
                    feature: feature.key,
                    beforeAmount: lastUsage.afterAmount,
                    afterAmount: lastUsage.afterAmount + ctx.body.amount,
                    amount: ctx.body.amount,
                })

                feature.hooks?.after?.({
                    customer, usage: {
                        amount: ctx.body.amount,
                        beforeAmount: lastUsage.afterAmount,
                        afterAmount: lastUsage.afterAmount + ctx.body.amount
                    },
                    feature
                })

                return res
            }),

            checkUsage: createAuthEndpoint(
                "/usage/check",
                {
                    method: "GET",
                    middleware: [middleware],
                    body: z.object({
                        referenceId: z.string(),
                        featureKey: z.string(),
                        overrideKey: z
                            .string()
                            .optional(),
                    }),
                    metadata: {
                        openapi: {
                            description: "Checks current usage",
                            parameters: [
                                {
                                    in: "query",
                                    name: "featureKey",
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
                    const feature = getFeature({
                        features,
                        overrides,
                        ...ctx.body
                    })

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
                        featureKey: z.string(),
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
                    const feature = getFeature({ features, overrides, ...ctx.body })
                    const { referenceType } = customers[ctx.body.referenceId];

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
                            referenceType: referenceType,
                            event: "reset"
                        })
                    }
                }
            ),
        },
    } satisfies BetterAuthPlugin;
}
