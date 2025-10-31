import type { Feature, Usage } from "@/types"
import { APIError, type Adapter } from "better-auth"
import type { UsageCache } from "../cache"


/**
 * Creates a usage "reset" record reflecting a feature's configured resetValue for a given reference.
 *
 * @param referenceId - The identifier for the entity whose usage is being reset.
 * @param curr - Optional current usage amount; when provided the reset amount is computed as `feature.resetValue - curr`.
 * @param feature - Feature metadata (must include `key` and `resetValue`) used to determine the reset amount and feature key.
 * @returns The created `Usage` record, or `undefined` when the feature has no `resetValue`.
 */
export async function resetUsageQuery({
    adapter,
    referenceId,
    curr,
    feature,
}: {
    adapter: Adapter,
    referenceId: string,
    curr?: number,
    feature: Omit<Feature, "hooks">
}) {
    if (!feature.resetValue) {
        return
    }

    if (curr) {

        const usage = await adapter.create<Usage>({
            model: "usage",
            data: {
                amount: feature.resetValue - curr,
                feature: feature.key,
                referenceId,
                event: "reset",
                lastResetAt: new Date(),
                createdAt: new Date()
            }
        })

        return usage
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
            const usage = await tx.create<Usage>({
                model: "usage",
                data: {
                    amount: feature.resetValue!,
                    feature: feature.key,
                    event: "reset",
                    referenceId,
                    lastResetAt: new Date(),
                    createdAt: new Date()
                }
            })

            return usage
        }
        const total = currentUsage.reduce((curr, { amount }) => amount + curr, 0)
        const usage = await tx.create<Usage>({
            model: "usage",
            data: {
                amount: feature.resetValue! - total,
                feature: feature.key,
                event: "reset",
                referenceId,
                lastResetAt: new Date(),
                createdAt: new Date()
            }
        })
        return usage
    })
    return transaction
}

