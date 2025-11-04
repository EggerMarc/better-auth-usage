import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { z } from "zod";
import type { EndpointParams } from "package/types";
import { getUsageAdapter } from "package/adapters";
import { getUsageMiddleware } from "package/middlewares/usage";
import { getCustomerMiddleware } from "@/middlewares/customer";
import { resolveGetCustomer } from "@/resolvers/get-customer";
import { tryCatch } from "@/utils";

/**
 * Create an authenticated POST endpoint at /usage/check that validates the request body and verifies a customer's latest usage against a feature's configured limits.
 *
 * @param options - Usage options (features, optional overrides, and cache settings) used to resolve features and control lookup behavior.
 * @returns The configured authenticated endpoint whose response is a status string describing the usage check result.
 */
export function getCheckCustomerEndpoint({ options, adapter }: EndpointParams) {
    return createAuthEndpoint(
        "/usage/check-customer",
        {
            method: "POST", // changed to POST so we can rely on body validation consistently
            middleware: [sessionMiddleware, getCustomerMiddleware({ options, adapter })],
            body: z.object({
                referenceId: z.string(),
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
                                    },
                                    required: ["referenceId"],
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
            const { data: customer, error } = await tryCatch(resolveGetCustomer({
                referenceId: ctx.body.referenceId,
                adapter,
                options
            }))

            if (error) {
                throw error
            }

            if (!customer) {
                throw new APIError("NOT_FOUND", {
                    message: `Customer with referenceId: ${ctx.body.referenceId} not found`
                })
            }

            return customer
        }
    )
}
