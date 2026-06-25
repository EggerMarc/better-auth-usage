import { Effect } from "effect"
import type { Feature } from "../types"
import { getUsage } from "./get-usage"
import { checkLimit } from "../utils"

interface CheckResult {
    allowed: boolean
    status: "in-limit" | "above-max-limit" | "below-min-limit"
    current: number
    max: number | undefined
    min: number | undefined
    remaining: number | null
    percent: number | null
}

/**
 * Check current usage against limits without consuming.
 * Optionally preview what would happen if `amount` were consumed.
 */
export const checkUsage = ({
    referenceId,
    feature,
    amount,
}: {
    referenceId: string
    feature: Omit<Feature, "hooks">
    amount?: number
}) =>
    Effect.gen(function* () {
        const usage = yield* getUsage({ referenceId, feature })

        const projected = usage.amount + (amount ?? 0)
        const status = checkLimit({
            maxLimit: feature.maxLimit,
            minLimit: feature.minLimit,
            value: projected,
        })

        return {
            allowed: status === "in-limit",
            status,
            current: usage.amount,
            currentAmount: usage.amount,  // backward compat
            max: feature.maxLimit,
            maxLimit: feature.maxLimit,    // backward compat
            min: feature.minLimit,
            minLimit: feature.minLimit,    // backward compat
            remaining: feature.maxLimit != null ? feature.maxLimit - usage.amount : null,
            percent: feature.maxLimit != null && feature.maxLimit > 0
                ? Math.round((usage.amount / feature.maxLimit) * 100)
                : null,
        }
    })

/**
 * canUse — alias for checkUsage with amount=1.
 * The entitlement check endpoint.
 */
export const canUse = ({
    referenceId,
    feature,
    amount = 1,
}: {
    referenceId: string
    feature: Omit<Feature, "hooks">
    amount?: number
}) => checkUsage({ referenceId, feature, amount })
