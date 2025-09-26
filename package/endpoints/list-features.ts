import { createAuthEndpoint } from "better-auth/api"
import type { UsageOptions } from "package/types"

/**
 * Creates an authenticated GET endpoint at "/usage/features" that lists registered features.
 *
 * @param features - Mapping of registered features; each value must contain `key` and `details`.
 * @returns An array of objects where each object has `featureKey` (the feature's key) and `details` (an array of detail strings).
 */
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
