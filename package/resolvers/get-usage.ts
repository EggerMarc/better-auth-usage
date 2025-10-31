import type { UsageAdapter } from "@/adapters";
import type { cached_Usage, Feature, Usage, UsageOptionsWithCache } from "@/types"
import { tryCatch } from "@/utils"
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

    let { data, error } = options.cache ? await tryCatch(
        options.cache.getUsage(referenceId, feature)
    ) : await tryCatch(
        adapter.getUsage({
            referenceId, feature
        })
    );

    if (error) {
        throw new APIError("INTERNAL_SERVER_ERROR", {
            message: `Failed to get`
        })
    }

    if (!data && options.cache) {
        let { data: adapterData, error: adapterError } = await tryCatch(
            adapter.getUsage({
                referenceId, feature
            })
        );

        if (adapterError) {
            throw new APIError("INTERNAL_SERVER_ERROR", {
                message: `Failed to get from adapter`
            })
        }

        if (adapterData) {
            await options.cache.insertEvent({
                referenceId,
                feature: feature.key,
                amount: adapterData.amount,
                event: adapterData.event
            });

            return normalizeData(adapterData, "db")
        }

        return {
            referenceId,
            feature: feature.key,
            amount: 0,
            event: undefined,
            createdAt: new Date(),
        } as Usage;
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
