import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { z } from "zod";
import type { EndpointParams, UsageOptions, UsageOptionsWithCache } from "package/types";
import { getUsageAdapter } from "package/adapters";
import { getUsageMiddleware } from "package/middlewares/usage";
import { getCustomerMiddleware } from "@/middlewares/customer";
import { resolveGetCustomer } from "@/resolvers/get-customer";
import { redactId, tryCatch } from "@/utils";
import { getUsageOptions } from "@/resolvers/options";

/**
 * Create an authenticated POST endpoint at /usage/check-customer that looks up a customer by referenceId.
 *
 * @param options - Usage options (features, optional overrides, and cache settings) used to resolve features and control lookup behavior.
 * @returns The configured authenticated endpoint whose response is the matching customer object.
 */
export function getCheckCustomerEndpoint(endpointOptions: UsageOptions) {
    return createAuthEndpoint(
        "/usage/check-customer",
        {
            method: "POST", // changed to POST so we can rely on body validation consistently
            middleware: [sessionMiddleware],
            body: z.object({
                referenceId: z.string(),
            }),
            metadata: {
                openapi: {
                    description: "Look up a customer by referenceId.",
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
                            description: "The customer object",
                            content: {
                                "application/json": {
                                    schema: {
                                        type: "object",
                                        properties: {
                                            referenceId: { type: "string" },
                                            referenceType: { type: "string" },
                                            email: { type: "string" },
                                            name: { type: "string" },
                                            overrideKey: { type: "string" },
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
        async (ctx) => {

            console.log("[LOG][ENDPOINT] Called check-customer for: ", redactId(ctx.body.referenceId))
            const { options, adapter } = await getUsageOptions({
                ctx: ctx.context,
                options: endpointOptions
            });

            const { data: customer, error } = await tryCatch(
                resolveGetCustomer({
                    referenceId: ctx.body.referenceId,
                    adapter,
                    options: options
                })
            )

            if (error) {
                throw error
            }

            if (!customer) {
                throw new APIError("NOT_FOUND", {
                    message: `Customer with referenceId: ${redactId(ctx.body.referenceId)} not found`
                })
            }

            return customer
        }
    )
}
