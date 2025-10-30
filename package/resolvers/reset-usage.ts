import type { Feature, Usage } from "@/types"
import { APIError, type Adapter } from "better-auth"

/**
 * Create a "reset" usage record to adjust stored usage to the feature's configured reset value when appropriate.
 *
 * If the feature has no `resetValue` the function does nothing. If `curr` is provided it records a reset with amount equal to `feature.resetValue - curr`. If `curr` is omitted it sums existing usage for the reference and records a reset with amount equal to `feature.resetValue - total` when prior usage exists.
 *
 * @param curr - Optional current usage amount used to compute the reset delta when provided
 * @param feature - Feature configuration (without hooks); `resetValue` and `key` are used to determine and label the reset
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
