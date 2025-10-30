import type { Feature, Usage } from "@/types";
import type { Adapter } from "better-auth";
import { resetUsageQuery } from "./reset-usage";
import { shouldReset } from "@/utils";

/**
 * Fetches the latest usage record for a feature and reference, triggering a reset flow when needed.
 *
 * @param referenceId - Identifier for the entity whose usage is being queried
 * @param feature - Feature configuration (without hooks) used to filter usage and evaluate reset rules
 * @returns The most recent usage record for the given feature and reference, or the usage record produced by the reset flow when no records exist or a reset is performed
 */
export async function getUsageQuery({
    adapter,
    referenceId,
    feature,
}: {
    adapter: Adapter,
    referenceId: string,
    feature: Omit<Feature, "hooks">
}) {

    const usage = await adapter.findMany<Usage>({
        model: "usage",
        where: [
            { field: "referenceId", value: referenceId },
            { field: "feature", value: feature.key }
        ],
        sortBy: { field: "createdAt", direction: "desc" },
    })

    if (usage.length === 0) {
        const reset = await resetUsageQuery({
            adapter,
            referenceId,
            curr: 0,
            feature
        })

        return reset
    }
    const last = usage[0];
    const current = usage.reduce((value, { amount }) => amount + value, 0)
    const reset = shouldReset(last ? (last.lastResetAt ?? null) : null, feature.reset ?? "never");
    if (reset.shouldReset && reset.nextReset) {
        // trigger sync
        const reset = await resetUsageQuery({
            adapter,
            referenceId,
            curr: current,
            feature,
        })
        return reset
    }
    return last
}

