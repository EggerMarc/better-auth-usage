import { createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { getUsageAdapter } from "package/adapter";
import { customerSchema } from "package/schema";

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
    })
}
