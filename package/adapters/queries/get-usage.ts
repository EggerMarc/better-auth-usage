import type { Feature, Usage } from "@/types";
import type { Adapter, TransactionAdapter } from "better-auth";

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
    const usage = await adapter.findMany<Usage>({
        model: "usage",
        where: [
            { field: "referenceId", value: referenceId },
            { field: "feature", value: feature.key }
        ],
        sortBy: { field: "createdAt", direction: "desc" },
    })
    const last = usage[0];
    const current = usage.reduce((value, { amount }) => amount + value, 0)
    return {
        ...last,
        amount: current
    } as Usage
}
