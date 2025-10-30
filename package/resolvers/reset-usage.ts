import type { Feature, Usage } from "@/types"
import { APIError, type Adapter } from "better-auth"

/**
 * Create a usage "reset" record for a feature when the feature defines a reset value.
 *
 * If `feature.resetValue` is falsy the function is a no-op. If `curr` is provided it records a single reset usage with amount equal to `feature.resetValue - curr`. If `curr` is not provided it aggregates existing usage records for the given reference and feature and records a reset usage with amount equal to `feature.resetValue - total`. If there are no existing usage records the function is a no-op.
 *
 * @param curr - Optional current usage amount to use instead of aggregating existing usage
 * @param feature - Feature descriptor (without hooks); its `resetValue` and `key` determine whether and how a reset usage is recorded
 */
export async function resolveResetUsage({
    adapter,
    referenceId,
    referenceType,
    curr,
    feature,
}: {
    adapter: Adapter,
    referenceId: string,
    referenceType: string,
    curr?: number,
    feature: Omit<Feature, "hooks">
}) {
    if (!feature.resetValue) {
        return //Success
    }

    if (curr) {
        const usage = await adapter.create<Usage>({
            model: "usage",
            data: {
                amount: feature.resetValue - curr,
                feature: feature.key,
                referenceId,
                referenceType,
                event: "reset",
                lastResetAt: new Date(),
                createdAt: new Date()
            }
        })

        return //Success
    }

    const transaction = await adapter.transaction(async (tx) => {
        const currentUsage = await tx.findMany<Usage>({
            model: "usage",
            where: [
                { field: "referenceId", value: referenceId },
                { field: "feature", value: feature.key },
            ],
            sortBy: { field: "createdAt", direction: "desc" }
        })
        if (currentUsage.length === 0) {
            return // Sync
        }
        const total = currentUsage.reduce((curr, { amount }) => amount + curr, 0)
        const usage = await tx.create<Usage>({
            model: "usage",
            data: {
                amount: feature.resetValue! - total,
                feature: feature.key,
                event: "reset",
                referenceId,
                referenceType,
                lastResetAt: new Date(),
                createdAt: new Date()
            }
        })
        return // Success
    })
}

export interface ResetError extends APIError { };
export interface ResetSuccess { }; // TODO
