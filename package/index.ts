import type { BetterAuthPlugin } from "better-auth";
import { APIError } from "better-auth/api"
import type { Customer, Feature, UsageOptions } from "./types.ts";
import { createAuthEndpoint, createAuthMiddleware } from "better-auth/api";
import { z } from "zod";
import { getUsageAdapter, type UsageAdapter } from "./adapter.ts";
import { checkLimit, shouldReset } from "./utils.ts";
import { customerSchema } from "./schema.ts";

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
    const { customers: initCustomers, features, overrides, getCustomer: getCustomerOverride } = options;
    const customers: Record<string, Customer> = initCustomers ? { ...initCustomers } : {};
    const featureKeys = Object.keys(features);

    async function syncUsage({
        adapter,
        feature,
        customer }: {
            adapter: UsageAdapter,
            feature: Feature,
            customer: Customer,
        }) {
        if (!feature.reset || feature.reset === "never") {
            return { reset: false, reason: "no-reset" };
        }

        const lastReset = await adapter.findLatestUsage({
            referenceId: customer.referenceId,
            featureKey: feature.key,
            event: "reset",
        });

        const lastResetDate = lastReset?.createdAt ?? null;
        const resetDue = shouldReset(lastResetDate, feature.reset);

        if (!resetDue) {
            return { reset: false, reason: "not-due" };
        }
        const usage = await adapter.insertUsage({
            afterAmount: feature.resetValue ?? 0,
            amount: 0,
            feature: feature.key,
            referenceId: customer.referenceId,
            referenceType: customer.referenceType,
            event: "reset",
        });

        return { reset: true, usage }
    }

    function getFeature(
        params: {
            featureKey: string,
            overrideKey?: string
            customer?: Customer
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

        if (params.customer?.featureLimits?.[params.featureKey]) {
            feature = {
                ...feature,
                ...params.customer.featureLimits[params.featureKey],
            };
        }

        return feature
    }

    const getCustomer: (referenceId: string, referenceType?: string) => Promise<Customer> =
        getCustomerOverride
            ? async (referenceId, referenceType) => await getCustomerOverride(referenceId, referenceType)
            : async (referenceId) => {
                const customer = customers[referenceId];
                if (!customer) {
                    throw new APIError("NOT_FOUND", { message: `Customer ${referenceId} not found` });
                }
                return customer;
            };

    const middleware = createAuthMiddleware(async (ctx) => {
        const session = ctx.context.session;
        if (!session) {
            throw new APIError("UNAUTHORIZED", { message: "Session not found" });
        }
        if (ctx.body?.referenceId && ctx.body?.featureKey) {
            const customer = await getCustomer(ctx.body.referenceId)
            const feature = getFeature({
                featureKey: ctx.body.featureKey,
                overrideKey: ctx.body.overrideKey,
                customer
            });
            const isAuthorized = (await feature.authorizeReference?.({
                ...ctx.body,
                customer,
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
                    createdAt: { type: "date", required: true },
                },
            },
        },

        endpoints: {
            /**
             * Get feature metadata (merged with overrides if provided).
             */
            getFeature: createAuthEndpoint(
                "/usage/feature",
                {
                    method: "POST",
                    middleware: [middleware],
                    body: z.object({
                        featureKey: z.string(),
                        overrideKey: z.string().optional(),
                        referenceId: z.string().optional()
                    }),
                    metadata: {
                        openapi: {
                            description: "Returns the feature configuration (merged with overrides if provided).",
                            requestBody: {
                                required: true,
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object",
                                            properties: {
                                                featureKey: { type: "string" },
                                                overrideKey: { type: "string" },
                                                referenceId: { type: "string" }
                                            },
                                            required: ["featureKey"],
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
                    const customer = ctx.body.referenceId ? await getCustomer(ctx.body.referenceId) : undefined;
                    const feature = getFeature({
                        featureKey: ctx.body.featureKey,
                        overrideKey: ctx.body.overrideKey,
                        customer: customer ? customer : undefined
                    });
                    const serializableFeature = { ...feature };
                    delete (serializableFeature as any).hooks;
                    return { feature: serializableFeature };
                }
            ),

            /**
             * Register or update an in-memory customer.
             * Uses `customerSchema` (zod) as the runtime validator.
             */
            registerCustomer: createAuthEndpoint(
                "/usage/register-customer",
                {
                    method: "POST",
                    body: customerSchema,
                    middleware: [middleware],
                    metadata: {
                        openapi: {
                            description: "Register or update a customer (in-memory by default).",
                            requestBody: {
                                required: true,
                                content: {
                                    "application/json": {
                                        schema: { type: "object" },
                                    },
                                },
                            },
                            responses: {
                                201: { description: "Customer registered/updated" },
                                400: { description: "Validation error" },
                            },
                        },
                    },
                },
                async (ctx) => {
                    const customer = ctx.body as Customer;
                    const adapter = getUsageAdapter(ctx.context);

                    if (!customer?.referenceId) {
                        throw new APIError("BAD_REQUEST", { message: "referenceId is required" });
                    }
                    customers[customer.referenceId] = customer;
                    await Promise.allSettled(featureKeys.map(async (featureKey) => {
                        const feature = getFeature({ featureKey, customer, overrideKey: customer.overrideKey });
                        await syncUsage({ adapter, customer, feature })
                    }))
                    return {
                        status: "created",
                        referenceId: customer.referenceId
                    };
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
                                                featureKey: { type: "string" },
                                                overrideKey: { type: "string" },
                                                amount: { type: "number", minimum: 1 },
                                                referenceId: { type: "string" },
                                                event: { type: "string" },
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
                    const customer = await getCustomer(ctx.body.referenceId);
                    const adapter = getUsageAdapter(ctx.context);
                    const feature = getFeature({
                        featureKey: ctx.body.featureKey,
                        overrideKey: ctx.body.overrideKey,
                        customer
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
                        feature: feature.key,
                        afterAmount,
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

            listCustomers: createAuthEndpoint(
                "/usage/customers",
                {
                    method: "GET",
                    middleware: [middleware],
                    metadata: {
                        openapi: {
                            description: "Lists registered customers. These are in-memory registered customers.",
                            responses: {
                                200: {
                                    description: "List of registered customers.",
                                    content: {
                                        "application/json": {
                                            schema: {
                                                type: "array",
                                                items: {
                                                    type: "object",
                                                    properties: {
                                                        referenceId: { type: "string" },
                                                        referenceType: { type: "string" },
                                                        email: { type: "string" },
                                                        name: { type: "string" },
                                                    },
                                                    required: ["referenceId", "referenceType"],
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
                    return Object.values(customers).map((c) => ({
                        referenceId: c.referenceId,
                        referenceType: c.referenceType,
                        email: c.email,
                        name: c.name,
                    }))
                }
            ),

            listFeatures: createAuthEndpoint(
                "/usage/features",
                {
                    method: "GET",
                    middleware: [middleware],
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
                    const adapter = getUsageAdapter(ctx.context);
                    const customer = await getCustomer(ctx.body.referenceId)
                    const feature = getFeature({
                        featureKey: ctx.body.featureKey,
                        overrideKey: ctx.body.overrideKey,
                        customer
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
                    const customer = await getCustomer(ctx.body.referenceId)
                    const adapter = getUsageAdapter(ctx.context);
                    const feature = getFeature({
                        featureKey: ctx.body.featureKey,
                        overrideKey: ctx.body.overrideKey,
                        customer
                    });
                    return await syncUsage({ customer, adapter, feature });
                }
            ),
        },
    } satisfies BetterAuthPlugin;
}

