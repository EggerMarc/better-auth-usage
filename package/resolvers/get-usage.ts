import type { UsageAdapter } from "@/adapters";
import type { cached_Usage, Feature, Usage, UsageOptionsWithCache } from "@/types"
import { normalizeData, tryCatch } from "@/utils"
import { APIError } from "better-auth"

interface ResolveGetUsageParams {
    referenceId: string,
    feature: Omit<Feature, "hooks">,
    options: UsageOptionsWithCache,
    adapter: UsageAdapter
}

export async function resolveGetUsage({
    referenceId,
    feature,
    options,
    adapter
}: ResolveGetUsageParams): Promise<Usage> {
    if (options.cache) {
        const { data } = await tryCatch(options.cache.getUsage(referenceId, feature))
        if (data) {
            return normalizeData(data, "cache")
        }
    }
    const { data } = await tryCatch(adapter.getUsage({ referenceId, feature }))
    if (data) {
        if (options.cache) {
            // For safekeeping, set the limit, the feature will have it
            options.cache.setLimit(referenceId, feature.key, {
                referenceId: data.referenceId,
                feature: data.feature,
                lastResetAt: data.lastResetAt,
                minLimit: feature.minLimit,
                maxLimit: feature.maxLimit,
            }).catch()

            await options.cache.insertEvent({
                ...data
            })
        }
    }
    if (!data) {
        // TODO handle case where we get no data
        throw new APIError("NOT_FOUND")
    }
    return normalizeData(data, "db")
}

