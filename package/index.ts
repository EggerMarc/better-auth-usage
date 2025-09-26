import type { BetterAuthPlugin } from "better-auth";
import { APIError } from "better-auth/api"
import type { Customer, Feature, UsageOptions } from "./types.ts";
import { createAuthEndpoint, createAuthMiddleware } from "better-auth/api";
import { z } from "zod";
import { getUsageAdapter, type UsageAdapter } from "./adapter.ts";
import { checkLimit } from "./utils.ts";
import { customerSchema } from "./schema.ts";
import { required } from "zod/mini";

/**
 * Usage plugin for BetterAuth
 *
 * Responsibilities:
 *  - provide endpoints to register customers (in-memory by default)
 *  - consume (meter) feature usage with before/after hooks
 *  - check usage limits
 *  - sync/reset usage according to `feature.reset`
 *
 * Notes:
 *  - Customer shape is validated at runtime with `customerSchema` (zod).
 *  - By default customers are kept in-memory (options.customers). Persistent customers
 *  and customer based limits is in the roadmap
 */
export function usage<O extends UsageOptions = UsageOptions>(options: O) {
    const { features, overrides } = options;

    async function syncUsage({
        adapter,
        feature,
        customer
    }: {
        adapter: UsageAdapter,
        feature: Feature,
        customer: Customer,
    }) {

        if (feature.reset) {
            return await adapter.syncUsage({
                referenceId: customer.referenceId,
                referenceType: customer.referenceType,
                feature: {
                    key: feature.key,
                    resetValue: feature.resetValue,
                    reset: feature.reset
                }
            })
        }
    }

    function getFeature(
        params: {
            featureKey: string,
            overrideKey?: string
        }
    ): Feature {
        let feature = features[params.featureKey]

        if (!feature) {
            throw new APIError("NOT_FOUND", { message: `Feature ${params.featureKey} not found` });
        }

        if (params.overrideKey && overrides?.[params.overrideKey]) {
            const override = overrides[params.featureKey];
            const overrideFeature = override?.features?.[params.featureKey];
            if (overrideFeature) {
                feature = {
                    ...feature,
                    ...overrideFeature,
                };
            }
        }
        /*
        if (params.customer?.featureLimits?.[params.featureKey]) {
            feature = {
                ...feature,
                ...params.customer.featureLimits[params.featureKey],
            };
        }
        */

        return feature
    }

    const middleware = createAuthMiddleware(async (ctx) => {
        const session = ctx.context.session;
        if (!session) {
            throw new APIError("UNAUTHORIZED", { message: "Session not found" });
        }
        if (ctx.body?.referenceId && ctx.body?.featureKey) {
            const feature = getFeature({
                featureKey: ctx.body.featureKey,
                overrideKey: ctx.body.overrideKey
            })
            const isAuthorized = (await feature.authorizeReference?.({
                ...ctx.body,
            })) ?? true;
            if (!isAuthorized) {
                throw new APIError("UNAUTHORIZED", {
                    message: `Customer unauthorized by feature ${feature.key}`,
                });
            }
        }
    });

    return {
        id: "@eggermarc/usage",
        schema: {
            usage: {
                fields: {
                    referenceId: { type: "string", required: true, input: true },
                    referenceType: { type: "string", required: true, input: true },
                    feature: { type: "string", required: true, input: true },
                    amount: { type: "number", required: true, input: true },
                    afterAmount: { type: "number", required: true, input: true },
                    event: { type: "string", required: true },
                    lastResetAt: { type: "date", required: true },
                    createdAt: { type: "date", required: true },
                },
            },
            customer: {
                fields: {
                    referenceId: { type: "string", required: true, input: true, unique: true },
                    referenceType: { type: "string", required: true, input: true },
                    email: { type: "string", required: false, input: true },
                    name: { type: "string", required: false, input: true }
                }
            }
        },

        endpoints: {
            /**
             * Get feature metadata (merged with overrides if provided).
             */
            getFeature: createAuthEndpoint(
                "/usage/features/:featureKey",
                {
                    method: "GET",
                    body: z.object({
                        overrideKey: z.string().optional(),
                    }),
                    metadata: {
                        openapi: {
                            description: "Returns the feature configuration (merged with overrides if provided).",
                            parameters: [{
                                in: "path",
                                name: "featureKey",
                                required: true,
                                schema: {
                                    type: "string",
                                },
                                description: "The key of the feature to retrieve"
                            }],
                            requestBody: {
                                required: true,
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object",
                                            properties: {
                                                overrideKey: { type: "string" },
                                            },
                                        },
                                    },
                                },
                            },
                            responses: {
                                200: {
                                    description: "Feature object",
                                    content: {
                                        "application/json": {
                                            schema: { type: "object" },
                                        },
                                    },
                                },
                                404: { description: "Feature not found" },
                            },
                        },
                    },
                },
                async (ctx) => {
                    const feature = getFeature({
                        featureKey: ctx.params.featureKey,
                        overrideKey: ctx.body.overrideKey,
                    });
                    const serializableFeature = { ...feature };
                    delete (serializableFeature as any).hooks;
                    return { feature: serializableFeature };
                }
            ),


            /**
             * Consume (meter) a feature for a given referenceId.
             * - runs before hook
             * - inserts usage row (adapter)
             * - runs after hook
             *
             * Idempotency & concurrency control are NOT implemented here (see suggestions below).
             */
            consumeFeature: createAuthEndpoint(
                "/usage/consume",
                {
                    method: "POST",
                    middleware: [middleware],
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

                    const feature = getFeature({
                        featureKey: ctx.body.featureKey,
                        overrideKey: ctx.body.overrideKey,
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
            ),

            listFeatures: createAuthEndpoint(
                "/usage/features",
                {
                    method: "GET",
                    metadata: {
                        openapi: {
                            description: "Lists registered features.",
                            responses: {
                                200: {
                                    description: "List of registered features.",
                                    content: {
                                        "application/json": {
                                            schema: {
                                                type: "array",
                                                items: {
                                                    type: "object",
                                                    properties: {
                                                        featureKey: { type: "string" },
                                                        details: {
                                                            type: "array",
                                                            items: { type: "string" },
                                                        },
                                                    },
                                                    required: ["featureKey"],
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
                async () => {
                    return Object.values(features).map((f) => ({
                        featureKey: f.key,
                        details: f.details,
                    }))
                }
            ),


            /**
             * Check usage limit for a feature for a specific reference.
             * Returns a small enum ("in-limit"|"above-limit"|"below-limit") based on checkLimit util.
             */
            checkUsage: createAuthEndpoint(
                "/usage/check",
                {
                    method: "POST", // changed to POST so we can rely on body validation consistently
                    middleware: [middleware],
                    body: z.object({
                        referenceId: z.string(),
                        featureKey: z.string(),
                        overrideKey: z.string().optional(),
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
                    const customer = await adapter.getCustomer({
                        referenceId: ctx.body.referenceId
                    });

                    if (!customer) {
                        throw new APIError("NOT_FOUND", { message: `Customer ${ctx.body.referenceId} not found` })
                    }
                    const feature = getFeature({
                        featureKey: ctx.body.featureKey,
                        overrideKey: ctx.body.overrideKey,
                    });
                    if (!feature) {
                        throw new APIError("NOT_FOUND", { message: "Feature not found" });
                    }

                    const usage = await adapter.findLatestUsage({
                        referenceId: ctx.body.referenceId,
                        featureKey: feature.key,
                    });

                    return checkLimit({
                        minLimit: feature.minLimit,
                        maxLimit: feature.maxLimit,
                        value: usage?.afterAmount ?? 0,
                    });
                }
            ),

            upsertCustomer: createAuthEndpoint("/usage/upsert-customer", {
                method: "POST",
                body: customerSchema,
                middleware: [middleware],
                metadata: {
                    openapi: {
                        description: "Upserts a customer to the customer table",
                        requestBody: {
                            required: true,
                            content: {
                                "application/json": {
                                    schema: {
                                        type: "object",
                                        properties: {
                                            referenceId: { type: "string" },
                                            featureType: { type: "string" },
                                            name: { type: "string" },
                                            email: { type: "string" }
                                        },
                                        required: ["referenceId", "featureType"],
                                    },
                                },
                            },
                        },
                        responses: {
                            200: {
                                description: "Successful Upsert",
                            },
                        },
                    },
                },
            }, async (ctx) => {
                const adapter = getUsageAdapter(ctx.context);
                const customer = await adapter.upsertCustomer(ctx.body);
                return customer
            }),

            /**
             * Sync usage according to feature.reset rules.
             * This will insert a reset event row with zeroed usage if the feature requires it.
             *
             * Note: you might prefer running this as a background job for many customers,
             * rather than via an endpoint.
             */
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
                    const feature = getFeature({
                        featureKey: ctx.body.featureKey,
                        overrideKey: ctx.body.overrideKey,
                    });

                    const usage = await syncUsage({ adapter, feature, customer })
                    return usage
                }
            ),
        },
    } satisfies BetterAuthPlugin;
}

