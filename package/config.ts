import type { UsageOptions } from "./types"

/**
 * Validate plugin configuration at init time.
 * Throws immediately with a clear message if config is invalid.
 * Better to fail fast on startup than silently produce wrong behavior.
 */
export function validateConfig(options: UsageOptions): void {
    const errors: string[] = []

    // Features must be non-empty
    const featureKeys = Object.keys(options.features)
    if (featureKeys.length === 0) {
        errors.push("features must have at least one feature defined")
    }

    // Validate each feature
    for (const [key, feature] of Object.entries(options.features)) {
        if (feature.maxLimit != null && feature.minLimit != null && feature.maxLimit < feature.minLimit) {
            errors.push(`features["${key}"]: maxLimit (${feature.maxLimit}) must be >= minLimit (${feature.minLimit})`)
        }

        if (feature.maxLimit != null && (!Number.isFinite(feature.maxLimit) || feature.maxLimit < 0)) {
            errors.push(`features["${key}"]: maxLimit must be a finite non-negative number`)
        }

        if (feature.minLimit != null && !Number.isFinite(feature.minLimit)) {
            errors.push(`features["${key}"]: minLimit must be a finite number`)
        }

        if (feature.resetValue != null && !Number.isFinite(feature.resetValue)) {
            errors.push(`features["${key}"]: resetValue must be a finite number`)
        }

        if (feature.onPlanChange && !["carry-over", "reset"].includes(feature.onPlanChange)) {
            errors.push(`features["${key}"]: onPlanChange must be "carry-over" or "reset"`)
        }
    }

    // Validate overrides reference existing features
    if (options.overrides) {
        for (const [overrideKey, override] of Object.entries(options.overrides)) {
            if (override.features) {
                for (const featureKey of Object.keys(override.features)) {
                    if (!options.features[featureKey]) {
                        errors.push(`overrides["${overrideKey}"] references unknown feature "${featureKey}"`)
                    }
                }
            }
        }
    }

    // Validate cache options
    if (options.cacheOptions) {
        if (!options.cacheOptions.redisUrl) {
            errors.push("cacheOptions.redisUrl is required when cacheOptions is provided")
        }

        if (options.cacheOptions.enableRealtime && !options.cacheOptions.port) {
            errors.push("cacheOptions.port is required when enableRealtime is true")
        }

        if (options.cacheOptions.wal) {
            if (options.cacheOptions.wal.drainStrategy &&
                !["subscribe", "poll"].includes(options.cacheOptions.wal.drainStrategy)) {
                errors.push('cacheOptions.wal.drainStrategy must be "subscribe" or "poll"')
            }

            if (options.cacheOptions.wal.pollInterval != null && options.cacheOptions.wal.pollInterval < 100) {
                errors.push("cacheOptions.wal.pollInterval must be at least 100ms")
            }
        }
    }

    if (errors.length > 0) {
        throw new Error(
            `[better-auth-usage] Invalid plugin configuration:\n${errors.map(e => `  - ${e}`).join("\n")}`
        )
    }
}
