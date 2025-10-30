import type { Feature, Usage } from "@/types"
import { APIError, type Adapter } from "better-auth"


/**
 * Create a usage record that applies a feature's reset and return the created usage.
 *
 * If `feature.resetValue` is falsy, the function performs no operation and returns `undefined`.
 *
 * @param referenceId - Identifier for the entity whose usage is being reset
 * @param curr - Optional current usage value; when provided the created usage amount will be `feature.resetValue - curr`
 * @param feature - Feature descriptor (without hooks). Its `resetValue` is used to compute the reset amount
 * @returns The created `Usage` record if a reset was recorded, `undefined` otherwise
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

export interface ResetError extends APIError { };
export interface ResetSuccess { }; // TODO
