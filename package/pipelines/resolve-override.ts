import { Effect } from "effect"
import { getCustomerOptional } from "./get-customer"

/**
 * Resolve the overrideKey for a request.
 *
 * If overrideKey is provided in the request body, use it.
 * Otherwise, look up the customer and use their stored overrideKey.
 * If no customer or no overrideKey on customer, returns undefined.
 */
export const resolveOverrideKey = ({
    overrideKey,
    referenceId,
}: {
    overrideKey?: string
    referenceId: string
}) =>
    Effect.gen(function* () {
        if (overrideKey) {
            return overrideKey
        }

        const customer = yield* getCustomerOptional(referenceId)
        return customer?.overrideKey
    })
