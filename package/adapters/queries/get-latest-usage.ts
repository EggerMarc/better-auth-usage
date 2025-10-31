import type { Feature, Usage } from "@/types";
import type { Adapter } from "better-auth";

export interface LatestUsageQueryParams {
    referenceId: string,
    feature: Omit<Feature, "hooks">,
    event?: string,
    adapter: Adapter
}

export const getLatestUsageQuery = async ({
    referenceId, feature, event, adapter
}: LatestUsageQueryParams) => {
    const conditions = event ? [{
        field: "referenceId",
        value: referenceId,
    },
    {
        field: "feature",
        value: feature.key
    }, {
        field: "event",
        value: event
    }] : [{
        field: "referenceId",
        value: referenceId,
    },
    {
        field: "feature",
        value: feature.key
    }]

    const usage = await adapter.findMany<Usage>({
        model: "usage",
        where: conditions,
        sortBy: {
            field: "createdAt",
            direction: "desc"
        }
    });

    return usage[0]
}

