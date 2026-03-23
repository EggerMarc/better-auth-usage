// Legacy adapter — kept for backward compatibility with cache.ts.
// New code uses DbService directly via Effect pipelines.

import type { AuthContext } from "better-auth/types";
import type { Customer, Feature } from "@/types.ts"
import { insertUsageQuery, type InsertUsageQueryParams } from "./queries/insert-usage";
import { getUsageQuery } from "./queries/get-usage";
import { upsertCustomerQuery } from "./queries/upsert-customer";
import { getCustomerQuery } from "./queries/get-customer";

export const getUsageAdapter = (context: AuthContext) => {
    const adapter = context.adapter;
    return {
        insertUsage: async ({
            amount,
            referenceId,
            event,
            feature,
            lastResetAt
        }: Omit<InsertUsageQueryParams, "adapter">) => {
            return insertUsageQuery({
                adapter, feature, lastResetAt, referenceId, amount, event
            })
        },

        getCustomer: async ({ referenceId }: { referenceId: string }) => {
            return await getCustomerQuery({ referenceId, adapter })
        },

        upsertCustomer: async (customer: Customer) => {
            return await upsertCustomerQuery({ customer, adapter })
        },

        getUsage: async ({ referenceId, feature }: {
            referenceId: string, feature: Omit<Feature, "hooks">
        }) => {
            return await getUsageQuery({ adapter, referenceId, feature })
        }
    };
};

export type UsageAdapter = ReturnType<typeof getUsageAdapter>
