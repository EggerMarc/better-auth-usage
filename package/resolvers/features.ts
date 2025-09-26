import { APIError } from "better-auth/api";
import type { Feature } from "../types";

/**
 * Resolve a Feature by key, applying optional override fields when present.
 *
 * @param featureKey - Key of the feature to resolve.
 * @param overrideKey - Optional key used to look up an entry in `overrides` whose `features` may contain per-feature overrides.
 * @param features - Mapping from feature keys to base Feature objects.
 * @param overrides - Optional mapping of override keys to override objects (each may include a `features` object).
 * @returns The resolved Feature, with properties merged from the matching override feature when available.
 * @throws APIError("NOT_FOUND") When no feature exists for `featureKey`.
 */
export function resolveFeature({
    featureKey,
    overrideKey,
    features,
    overrides,
}: {
    featureKey: string;
    overrideKey?: string;
    features: Record<string, Feature>;
    overrides?: Record<string, any>;
}): Feature {
    let feature = features[featureKey];

    if (!feature) {
        throw new APIError("NOT_FOUND", { message: `Feature ${featureKey} not found` });
    }

    if (overrideKey && overrides?.[overrideKey]) {
        const override = overrides[overrideKey];
        const overrideFeature = override?.features?.[featureKey];
        if (overrideFeature) {
            feature = { ...feature, ...overrideFeature };
        }
    }

    return feature;
}

