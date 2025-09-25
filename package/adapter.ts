import type { AuthContext } from "better-auth/types";
import type { Usage } from "./types.ts"

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
                field: "referenceId",
                value: referenceId,
            },
            {
                field: "feature",
                value: featureKey
            }, {
                field: "event",
                value: event
            }] : [{
                field: "referenceId",
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
                    field: "createdAt",
                    direction: "desc"
                }
            });
            return usage[0]
        },

        insertUsage: async ({
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
                    afterAmount: afterAmount
                }
            })
            return usage
        },

        syncUsage: async ({

        }) => {

        }
    };
};

export type UsageAdapter = ReturnType<typeof getUsageAdapter>
