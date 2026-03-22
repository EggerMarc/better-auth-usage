import type { UsageAdapter } from "@/adapters";
import type { Customer, UsageOptionsWithCache } from "@/types";
import { redactId, tryCatch } from "@/utils";
import { APIError } from "better-auth";

interface ResolveGetCustomerParams {
    referenceId: string,
    adapter: UsageAdapter,
    options: UsageOptionsWithCache
}

/**
 * Fetches a Customer by referenceId, preferring a configured cache and falling back to the adapter.
 *
 * @param referenceId - The customer reference identifier to look up
 * @param adapter - Adapter used to retrieve the customer from the primary data store
 * @param options - Options that may include a cache; when `options.cache` is present, the function will attempt a cache read before querying the adapter and will asynchronously write a successful result back to the cache
 * @returns The Customer matching `referenceId`
 * @throws APIError with code `INTERNAL_SERVER_ERROR` if a cache read or database read fails
 * @throws APIError with code `NOT_FOUND` if no customer is found in the database
 */
export async function resolveGetCustomer({ referenceId, options, adapter }: ResolveGetCustomerParams): Promise<Customer> {
    if (options.cache) {
        const { data: customer, error } = await tryCatch(
            options.cache.getCustomer(referenceId)
        )
        if (error) {
            throw new APIError("INTERNAL_SERVER_ERROR", {
                message: `Failed getting customer ${redactId(referenceId)} from cache`
            })
        }
        if (customer) {
            return customer
        }
    }

    const { data: customer, error } = await tryCatch(
        adapter.getCustomer({ referenceId })
    );

    if (error) {
        throw new APIError("INTERNAL_SERVER_ERROR", {
            message: `Failed getting customer ${redactId(referenceId)} from DB`
        })
    }

    if (!customer) {
        throw new APIError("NOT_FOUND", {
            message: `Customer ${redactId(referenceId)} not found in db`
        })
    }

    if (options.cache) {
        console.log(`Cache was empty, but we got this from db: ${JSON.stringify(customer)}`)
    }

    if (options.cache) {
        console.log("synching to cache");
        options.cache.setCustomer(customer).catch((error) => {
            console.log(error)
        })
    }

    return customer
}
