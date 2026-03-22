import type { Feature, Usage } from "@/types";
import { APIError, type Adapter, type TransactionAdapter } from "better-auth";
import { tryCatch } from "@/utils";
/**
 * Build a Usage object for a reference and feature where the returned record is the most recent usage entry with its `amount` replaced by the total across all matching usage records.
 *
 * @param referenceId - Identifier of the entity whose usage is queried
 * @param feature - Feature (without `hooks`) whose usage records to evaluate
 * @returns A `Usage` object copied from the most recent matching record with `amount` set to the sum of `amount` from all matching records
 */
export async function getUsageQuery({
    adapter,
    referenceId,
    feature,
}: {
    adapter: Adapter | TransactionAdapter,
    referenceId: string,
    feature: Omit<Feature, "hooks">,
}) {

    const { data: usage, error } = await tryCatch(
        adapter.findMany<Usage>({
            model: "usage",
            where: [
                { field: "referenceId", value: referenceId },
                { field: "feature", value: feature.key }
            ],
            sortBy: { field: "createdAt", direction: "desc" },
        })
    )

    const many = await adapter.count({
        model: "usage",
        where: [
            { field: "referenceId", value: referenceId },
            { field: "feature", value: feature.key }
        ]
    })

    console.log(`[bau], count of usage: ${many}`)
    const logCurrent = usage!.reduce((value, { amount }) => amount + value, 0)
    console.log(`[bau] got this many ${logCurrent}, on ${usage!.length} items`)
    if (error) {
        throw new APIError("INTERNAL_SERVER_ERROR", {
            message: `Failed to get usage from db, thrown the following error\n${error.message}`
        })
    }

    if (!usage || usage.length === 0) {
        // Not sure how I feel with this. If somehow we bypass a customer, we enter a value that doesn't exist.
        const now = new Date()
        const initialUsage: Usage = {
            referenceId,
            amount: feature.resetValue ?? 0,
            feature: feature.key,
            createdAt: now,
            lastResetAt: now,
            event: "sync"
        }

        adapter.create<Usage>({ model: "usage", data: initialUsage }).catch(() => {
            console.log(`[ERROR][USAGE] Failed to add initial usage for customer ${referenceId} on feature ${feature.key}`)
        })

        return initialUsage
    }

    const last = usage[0];
    const current = usage.reduce((value, { amount }) => amount + value, 0)
    return {
        ...last,
        amount: current
    } as Usage
}
