import type { UsageAdapter } from "@/adapters";
import type { Customer, UsageOptionsWithCache } from "@/types";
import { tryCatch } from "@/utils";
import { APIError } from "better-auth";

interface UpsertCustomerParams {
    adapter: UsageAdapter,
    options: UsageOptionsWithCache,
    customer: Customer
}

export const resolveUpsertCustomer = async ({
    adapter, options, customer
}: UpsertCustomerParams) => {
    const { data, error } = await tryCatch(adapter.upsertCustomer(customer));

    if (error || !data) {
        throw new APIError("INTERNAL_SERVER_ERROR", {
            message: `Failed to upsert customer on DB \n${error ? error.message : "No data returned"}`
        })
    }

    options.cache && options.cache.setCustomer(data).catch(() => {
        console.log("[ERROR][CUSTOMER] Cache failed to insert customer")
    })
    return data
}
