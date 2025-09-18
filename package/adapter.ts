import type { AuthContext } from "better-auth/types";
import type { Usage } from "./types"

export const getAdminAdapter = (context: AuthContext) => {
    const adapter = context.adapter;
    return {
        findLatestUsage: async (referenceId: string, feature: string) => {
            const usage = await adapter.findMany<Usage>({
                model: "usage",
                where: [
                    {
                        field: "reference_id",
                        value: referenceId,
                    },
                    {
                        field: "feature",
                        value: feature
                    }
                ],
                sortBy: {
                    field: "created_at",
                    direction: "desc"
                }
            });
            return usage[0]
        },

        insertUsage: async (
            beforeAmount: number,
            afterAmount: number,
            amount: number,
            referenceId: string,
            referenceType: string,
            feature: string,
            event?: string
        ) => {
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
