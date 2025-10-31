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


// Checks if we need to reset, if so, run resetLogic
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

