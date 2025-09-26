import { createAuthEndpoint } from "better-auth/api"
import type { UsageOptions } from "package/types"

export function getFeaturesEndpoint({ features }: UsageOptions) {
    return createAuthEndpoint(
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
    )
}
