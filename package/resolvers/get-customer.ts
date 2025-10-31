import type { UsageAdapter } from "@/adapters";
import type { Customer, UsageOptionsWithCache } from "@/types";
import { tryCatch } from "@/utils";
import { APIError } from "better-auth";

interface ResolveGetCustomerParams {
    referenceId: string,
    adapter: UsageAdapter,
    options: UsageOptionsWithCache
}

export async function resolveGetCustomer({ referenceId, options, adapter }: ResolveGetCustomerParams): Promise<Customer> {
    if (options.cache) {
        const { data: customer, error } = await tryCatch(options.cache.getCustomer(referenceId))
        if (error) {
            throw new APIError("INTERNAL_SERVER_ERROR", {
                message: `Failed getting customer ${referenceId} from cache`
            })
        }
        if (customer) {
            return customer
        }
    }

    const { data: customer, error } = await tryCatch(adapter.getCustomer({ referenceId }));

    if (error) {
        throw new APIError("INTERNAL_SERVER_ERROR", {
            message: `Failed getting customer ${referenceId} from DB`
        })
    }

    if (!customer) {
        // TODO handle not found
        throw new APIError("NOT_FOUND", {
            message: `Customer ${referenceId} not found in db`
        })
    }

    if (options.cache) {
        options.cache.setCustomer(customer).catch((error) => {
            console.log(error)
        })
    }

    return customer
}
