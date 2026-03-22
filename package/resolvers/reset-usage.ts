/* DEPRECATE NOTICE
 * Due to bad naming, this function is a duplicate of sync-usage.ts
 * Use that, I'll delete this in no time
 */
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
 * Perform a usage reset for a feature when its reset condition is met.
 *
 * If the feature has no reset configuration or no reset is required, the function returns without action.
 *
 * @param referenceId - Identifier for the entity whose usage is being evaluated
 * @param feature - Feature configuration (without hooks); its `reset` field controls reset behavior and `resetValue` is used to compute the reset delta
 * @param options - Usage options; when `options.cache` is present, cache is updated and used to record the reset event
 * @param adapter - Usage adapter used to execute a reset when the cache is not available or to notify the backing store
 * @returns The reset event data returned by the cache insertion or the adapter's `resetUsage` result when a reset is performed; otherwise `undefined`
 */
export async function resolveResetUsage({
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
                amount: (feature.resetValue ?? 0) - data.amount,
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
