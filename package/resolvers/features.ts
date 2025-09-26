import { APIError } from "better-auth/api";
import type { Feature } from "../types";

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
        const override = overrides[featureKey];
        const overrideFeature = override?.features?.[featureKey];
        if (overrideFeature) {
            feature = { ...feature, ...overrideFeature };
        }
    }

    return feature;
}

