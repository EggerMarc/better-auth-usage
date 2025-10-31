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
                }).catch()
            }
        }

        if (options.cache) {
            // For safekeeping, set the limit, the feature will have it
            options.cache.insertEvent({
                ...data,
            }).catch(() => { })
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

