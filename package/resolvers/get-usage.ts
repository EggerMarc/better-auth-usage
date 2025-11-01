import type { UsageAdapter } from "@/adapters";
import type { Feature, Usage, UsageOptionsWithCache } from "@/types"
import { normalizeData, shouldReset, tryCatch } from "@/utils"
import { APIError } from "better-auth"

interface ResolveGetUsageParams {
    referenceId: string,
    feature: Omit<Feature, "hooks">,
    options: UsageOptionsWithCache,
    adapter: UsageAdapter
}

/**
 * Retrieve usage for a reference and feature, preferring cache and falling back to the adapter.
 *
 * Attempts to load usage from `options.cache` when available; if not found or cache is absent, fetches from `adapter`. When data is returned from the adapter, updates the cache (limit and event) if a cache is configured.
 *
 * @param referenceId - Identifier for the usage owner (for example, a tenant or user ID)
 * @param feature - Feature metadata describing the usage key and reset/limit configuration
 * @param options - Runtime options that may include a cache implementation
 * @param adapter - Persistence adapter used to fetch usage when not available in cache
 * @returns The resolved `Usage` record normalized for its source
 * @throws APIError with code `INTERNAL_SERVER_ERROR` if reading from cache or the adapter fails
 * @throws APIError with code `NOT_FOUND` if no usage is found in the adapter
 */
export async function resolveGetUsage({
    referenceId,
    feature,
    options,
    adapter
}: ResolveGetUsageParams): Promise<Usage> {

    if (options.cache) {
        const { data, error } = await tryCatch(options.cache.getUsage(referenceId, feature))
        if (error) {
            throw new APIError("INTERNAL_SERVER_ERROR", {
                message: `Failed getting usage ${feature.key} from cache\n${error.message}`
            })
        }

        if (data) {
            return normalizeData(data, "cache")
        }
    }

    const { data, error } = await tryCatch(adapter.getUsage({ referenceId, feature }));

    if (error) {
        throw new APIError("INTERNAL_SERVER_ERROR", {
            message: `Failed getting usage ${feature.key} from db\n${error.message}`
        })
    }

    if (data) {
        if (feature.reset) {
            const reset = shouldReset(data?.lastResetAt, feature.reset);

            if (options.cache) {
                options.cache.setLimit(referenceId, feature.key, {
                    referenceId: data.referenceId,
                    feature: data.feature,
                    resetAt: reset.nextReset,
                    lastResetAt: data.lastResetAt,
                    minLimit: feature.minLimit,
                    maxLimit: feature.maxLimit,
                }).catch(() => {
                    console.log("[ERROR][USAGE] Error setting limits in cache")
                })
            }
        }

        if (options.cache) {
            // For safekeeping, set the limit, the feature will have it
            options.cache.insertEvent({
                ...data,
            }).catch(() => {
                console.log("[ERROR][USAGE] Error inserting event in cache")
            })
        }
    }
    if (!data) {
        // TODO handle case where we get no data
        throw new APIError("NOT_FOUND", {
            message: `Usage ${feature.key} not found in db`
        })
    }
    return normalizeData(data, "db")
}
