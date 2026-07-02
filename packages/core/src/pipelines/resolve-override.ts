import { Effect } from "effect"
import { getCustomerOptional } from "./get-customer"

/**
 * Resolve the overrideKey for a request.
 *
 * If overrideKey is provided in the request body, use it.
 * Otherwise, look up the customer and use their stored overrideKey.
 * If no customer or no overrideKey on customer, returns undefined.
 *
 * Used by check/can-use/sync — callers that need only the key. Consume uses
 * `resolveCustomerAndOverride` instead so it can reuse the customer it loads
 * here (one DO/DB round-trip instead of two).
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

/**
 * Resolve the customer AND the effective overrideKey in a single customer
 * lookup. The consume pipeline needs the customer anyway (hooks + the
 * `overrideKey` recorded on the usage event), so returning it here avoids the
 * second fetch it used to do.
 *
 * A body-provided overrideKey still wins over the customer's stored key.
 */
export const resolveCustomerAndOverride = ({
    overrideKey,
    referenceId,
}: {
    overrideKey?: string
    referenceId: string
}) =>
    Effect.gen(function* () {
        const customer = yield* getCustomerOptional(referenceId)
        return { customer, overrideKey: overrideKey ?? customer?.overrideKey }
    })
