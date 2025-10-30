import type { Feature, Usage } from "@/types";
import type { Adapter } from "better-auth";
import { resetUsageQuery } from "./reset-usage";
import { shouldReset } from "@/utils";

/**
 * Retrieves the latest usage record for a given reference and feature, triggering a reset operation when no records exist or the feature's reset policy indicates a reset is due.
 *
 * @param referenceId - Identifier of the entity whose usage is being queried.
 * @param feature - Feature configuration (with `hooks` omitted) that determines which usage to query and the reset policy.
 * @returns The most recent `Usage` record for the given reference and feature, or the result of the reset operation when a reset is performed or no usage records exist.
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

