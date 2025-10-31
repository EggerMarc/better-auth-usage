import { resolveGetCustomer } from "@/resolvers/get-customer";
import { resolveUpsertCustomer } from "@/resolvers/upsert-customer";
import type { UsageOptionsWithCache } from "@/types";
import { tryCatch } from "@/utils";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { getUsageAdapter } from "package/adapters";
import { customerSchema } from "package/schema";

/**
 * Creates an authenticated POST endpoint at "/usage/upsert-customer" that upserts a customer record.
 *
 * The endpoint expects a JSON body containing `referenceId` and `referenceType` (required), and optional
 * `name` and `email`. The endpoint applies session authentication and returns the upserted customer object.
 *
 * @returns The configured endpoint handler which accepts the customer payload and returns the upserted customer object
 */
export function getUpsertCustomerEndpoint(options: UsageOptionsWithCache) {
    return createAuthEndpoint("/usage/upsert-customer", {
        method: "POST",
        body: customerSchema,
        middleware: [sessionMiddleware],
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
                                    referenceType: { type: "string" },
                                    name: { type: "string" },
                                    email: { type: "string" },
                                },
                                required: ["referenceId", "referenceType"],
                            },
                        },
                    },
                    responses: {
                        200: {
                            description: "Successful Upsert",
                        },
                        500: {
                            description: "Internal server error",
                        }
                    },
                },
            },
        }
    }, async (ctx) => {
        const adapter = getUsageAdapter(ctx.context);
        const { data: customer, error } = await tryCatch(
            resolveUpsertCustomer({
                adapter, options, customer: {
                    referenceId: ctx.body.referenceId,
                    referenceType: ctx.body.referenceType,
                    name: ctx.body.name,
                    email: ctx.body.email,
                    overrideKey: ctx.body.overrideKey
                }
            })
        );
        if (error || !customer) {
            throw new APIError("INTERNAL_SERVER_ERROR", {
                message: `Failed to upsert customer ${ctx.body.referenceId}, ${error ? error.message : 'customer not upserted'}`
            })
        }
        return customer
    })
}
