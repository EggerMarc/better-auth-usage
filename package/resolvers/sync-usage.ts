import type { Feature, UsageOptionsWithCache } from "../types"
import type { UsageAdapter } from "@/adapters"
import { resolveGetUsage } from "./get-usage"
import { shouldReset } from "@/utils"

interface ResolveResetUsageParams {
    referenceId: string,
    feature: Omit<Feature, "hooks">,
    options: UsageOptionsWithCache,
    adapter: UsageAdapter
}


/**
 * Determines whether a feature's usage should be reset and performs the reset if needed.
 *
 * @param referenceId - Identifier for the entity whose usage is evaluated
 * @param feature - Feature configuration (without hooks) including reset rules and limits
 * @param options - Runtime options that may include a cache implementation used to update limits and record reset events
 * @param adapter - Adapter used to perform remote reset operations when no cache is available
 * @returns The data produced by the reset operation (e.g., the cache event result or adapter response) when a reset occurs, or `undefined` if no reset was performed
 */
export async function resolveSyncUsage({
    referenceId,
    feature,
    options,
    adapter
}: ResolveResetUsageParams) {
    if (!feature.reset) {
        return
    }

    const data = await resolveGetUsage({ referenceId, feature, options, adapter });
    const reset = shouldReset(data.lastResetAt, feature.reset);

    if (options.cache) {
        options.cache.setLimit(referenceId, feature.key, {
            referenceId,
            feature: feature.key,
            lastResetAt: data.lastResetAt,
            maxLimit: feature.maxLimit,
            minLimit: feature.minLimit,
            resetValue: feature.resetValue,
            resetAt: reset.nextReset,
        }).catch(() => { console.log("[ERROR][CACHE] Failed to update limit") })
    }

    if (!reset.shouldReset) {
        return
    } else {
        if (options.cache) {
            // Non blocking 
            adapter.resetUsage({
                referenceId,
                feature,
                curr: data.amount,
            }).catch()

            const resetData = await options.cache.insertEvent({
                referenceId,
                feature: feature.key,
                amount: (feature.resetValue ?? 0 - data.amount),
                event: "reset"
            })

            return resetData
        }
    }

    const resetData = await adapter.resetUsage({
        referenceId,
        feature,
        curr: data.amount,
    })
    return resetData
}
