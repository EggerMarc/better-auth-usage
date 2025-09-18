import type { AuthContext } from "better-auth/types";
import type { Usage } from "./types"

export const getUsageAdapter = (context: AuthContext) => {
    const adapter = context.adapter;
    return {
        findLatestUsage: async ({
            referenceId,
            featureKey,
            event
        }: {
            referenceId: string,
            featureKey: string,
            event?: string
        }) => {
            const conditions = event ? [{
                field: "reference_id",
                value: referenceId,
            },
            {
                field: "feature",
                value: featureKey
            }, {
                field: "event",
                value: event
            }] : [{
                field: "reference_id",
                value: referenceId,
            },
            {
                field: "feature",
                value: featureKey
            }]

            const usage = await adapter.findMany<Usage>({
                model: "usage",
                where: conditions,
                sortBy: {
                    field: "created_at",
                    direction: "desc"
                }
            });
            return usage[0]
        },

        insertUsage: async ({
            beforeAmount,
            afterAmount,
            amount,
            referenceId,
            referenceType,
            feature,
            event
        }: Omit<Usage, "createdAt">) => {
            const usage = await adapter.create<Usage>({
                model: "usage",
                data: {
                    referenceId,
                    referenceType,
                    feature,
                    event,
                    amount,
                    createdAt: new Date(Date.now()),
                    beforeAmount: beforeAmount,
                    afterAmount: afterAmount
                }
            })
            return usage
        },
    };
};
