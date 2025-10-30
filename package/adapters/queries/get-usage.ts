import type { Feature, Usage } from "@/types";
import type { Adapter } from "better-auth";
import { resetUsageQuery } from "./reset-usage";
import { shouldReset } from "@/utils";

/**
 * Retrieve the current usage state for a given reference and feature, triggering and returning a reset record when no usage exists or a reset is required.
 *
 * @param referenceId - The identifier for the entity whose usage is being queried
 * @param feature - The feature (without hooks) whose usage and reset policy to evaluate
 * @returns The most recent `Usage` record for the given `referenceId` and `feature`, or the `Usage` record produced by a reset operation when no records exist or a reset is due
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

