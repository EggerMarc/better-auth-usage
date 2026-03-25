import { Effect } from "effect"
import { FeatureNotFound } from "@/errors"
import type { Feature } from "@/types"

/**
 * Resolve a Feature by key, applying optional override fields.
 *
 * Returns: Effect<Feature, FeatureNotFound>
 *
 * The error is in the type — callers know this can fail with FeatureNotFound
 * and must handle it (or let it propagate up the pipeline).
 */
export const resolveFeature = ({
    featureKey,
    overrideKey,
    features,
    overrides,
}: {
    featureKey: string
    overrideKey?: string
    features: Record<string, Feature>
    overrides?: Record<string, any>
}) =>
    Effect.gen(function* () {
        const base = features[featureKey]

        if (!base) {
            return yield* new FeatureNotFound({ featureKey })
        }

        if (overrideKey && overrides?.[overrideKey]) {
            const overrideFeature = overrides[overrideKey]?.features?.[featureKey]
            if (overrideFeature) {
                return { ...base, ...overrideFeature }
            }
        }

        return base
    })
