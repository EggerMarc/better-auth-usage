import { createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { getUsageAdapter } from "package/adapter";
import { customerSchema } from "package/schema";

/**
 * Creates an authenticated POST endpoint at "/usage/upsert-customer" that upserts a customer record.
 *
 * The endpoint expects a JSON body containing `referenceId` and `referenceType` (required), and optional
 * `name`, `email`, and `overrideKey`. The endpoint applies session authentication and returns the upserted customer object.
 *
 * @returns The configured endpoint handler which accepts the customer payload and returns the upserted customer object
 */
export function getUpsertCustomerEndpoint() {
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
                                    overrideKey: { type: "string" }
                                },
                                required: ["referenceId", "referenceType"],
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
        }
    }, async (ctx) => {
        const adapter = getUsageAdapter(ctx.context);
        const customer = await adapter.upsertCustomer(ctx.body);
        return customer
    })
}
