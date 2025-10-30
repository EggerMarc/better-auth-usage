import type { cached_Usage, Feature, Usage, UsageOptionsWithCache } from "@/types"
import { tryCatch } from "@/utils"
import { APIError } from "better-auth"

interface ResolveGetUsageParams {
    referenceId: string,
    feature: Omit<Feature, "hooks">,
    options: UsageOptionsWithCache
}

export async function resolveGetUsage({
    referenceId,
    feature,
    options,
}: ResolveGetUsageParams) {
    let { data, error } = options.cache ? await tryCatch(
        options.cache.getUsage(referenceId, feature)
    ) : await tryCatch(
        options.adapter.getUsage({
            referenceId, feature
        })
    );

    if (error) {
        throw new APIError("INTERNAL_SERVER_ERROR", {
            message: ""
        })
    }

    if (!data) {
        throw new APIError("NOT_FOUND", {
            message: ""
        })
    }

    return normalizeData(data, options.cache ? "cache" : "db")
}

function normalizeData<
    TSource extends "cache" | "db"
>(
    data: TSource extends "cache" ? cached_Usage : Usage,
    source: TSource
): Usage {
    if (source === "cache") {
        const d = (data as cached_Usage)

        return {
            referenceId: d.referenceId,
            feature: d.feature,
            amount: d.current,
            event: undefined,
            createdAt: d.updatedAt,
            lastResetAt: d.lastResetAt
        } as Usage
    }

    return data as Usage
}

