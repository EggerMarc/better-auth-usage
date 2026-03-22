import { createAuthEndpoint } from "better-auth/api";
import { resolveFeature } from "package/resolvers/features";
import type { UsageOptions } from "package/types";
import { z } from "zod";

/**
 * Registers an authenticated GET endpoint at /usage/features/:featureKey that returns a feature configuration.
 *
 * The endpoint resolves the feature identified by the path parameter `featureKey`. If an `overrideKey` is provided
 * in the request body, matching overrides are applied to the returned configuration. Runtime hooks are removed
 * from the returned object.
 *
 * @param options - Usage options containing `features` and `overrides` used to resolve the feature
 * @returns The configured authenticated endpoint which returns the resolved feature object (with overrides applied and `hooks` omitted)
 */
export function getFeatureEndpoint({
    features, overrides
}: UsageOptions) {
    return createAuthEndpoint(
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
            const feature = resolveFeature({
                featureKey: ctx.params.featureKey,
                overrideKey: ctx.body.overrideKey,
                features,
                overrides
            });
            const serializableFeature = { ...feature };
            delete (serializableFeature as any).hooks;
            return { feature: serializableFeature };
        }
    )
}
