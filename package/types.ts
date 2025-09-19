import { customerSchema, usageSchema } from "./schema.ts"
import { z } from "zod";

/**
 * Usage entry as inferred from the Zod schema.
 * Represents a single recorded usage event.
 */
export type Usage = z.infer<typeof usageSchema>;

/**
 * Generic key/value store for extending base types
 * with arbitrary string fields.
 */
type ExtraFields = {
    [key: string]: string;
};

/**
 * Core Customer type used across the plugin.
 *
 * - `referenceId`: Unique ID of the customer (e.g. UUID, tenant ID).
 * - `referenceType`: Logical grouping or type of reference (e.g. "org", "user").
 * - `email` / `name`: Optional metadata for identification.
 * - `featureLimits`: Overrides feature limits for this specific customer.
 *
 */
export type Customer = z.infer<typeof customerSchema>

/**
 * Represents the deltas of usage for a single operation.
 *
 * - `beforeAmount`: Usage count before consumption.
 * - `afterAmount`: Usage count after consumption.
 * - `amount`: Amount consumed in this operation.
 */
export type UsageData = {
    beforeAmount: number;
    afterAmount: number;
    amount: number;
};

/**
 * Extended customer type, combining base `Customer` fields
 * with arbitrary extra fields defined by the user.
 */
export type CustomerExpanded = Customer & ExtraFields;

/**
 * Feature definition.
 *
 * Each feature represents a quota, limit, or tracked resource
 * that customers can consume.
 */
export type Feature = {
    /**
     * Unique identifier of the feature (e.g. `"api-tokens"`).
     */
    key: string;

    /**
     * Maximum allowed usage for this feature.
     */
    maxLimit?: number;

    /**
     * Minimum allowed usage for this feature.
     */
    minLimit?: number;

    /**
     * Optional descriptive metadata (could be displayed in UI).
     */
    details?: string[];

    /**
     * Associated Stripe product/price ID (for billing integration).
     */
    stripeId?: string;

    /**
     * Defines how often the feature usage resets.
     */
    reset?: ResetType;

    /**
     * Optional numeric reset modifier (e.g. reset every 3 days).
     */
    resetValue?: number;

    /**
     * Lifecycle hooks triggered before/after consumption.
     * Useful for enforcing business rules or side effects.
     */
    hooks?: {
        /**
         * Executed *before* consumption is persisted.
         */
        before?: (props: {
            usage: UsageData;
            customer: Customer;
            feature: Feature;
        }) => Promise<void> | void;

        /**
         * Executed *after* consumption is persisted.
         */
        after?: (props: {
            usage: UsageData;
            customer: Customer;
            feature: Feature;
        }) => Promise<void> | void;
    };

    /**
     * Optional authorization function that decides if a given
     * customer is allowed to consume this feature.
     */
    authorizeReference?: <BT>(params: {
        body: BT;
        customer: Customer;
    }) => Promise<boolean> | boolean;
};

/**
 * Dictionary of features keyed by their unique `key`.
 */
export type Features = Record<string, Feature>;

/**
 * Dictionary of customers keyed by their `referenceId`.
 */
export type Customers = Record<string, Customer>;

/**
 * Overrides allow customizing features at a customer or plan level.
 *
 * Example:
 * ```ts
 * {
 *   "customer-123": {
 *     features: {
 *       "api-tokens": { maxLimit: 5000 }
 *     }
 *   }
 * }
 * ```
 */
export type Overrides = Record<
    string,
    {
        features: Record<string, Partial<Omit<Feature, "key">>>;
    }
>;

/**
 * Feature with arbitrary extra fields.
 */
export type FeatureExpanded = Feature & ExtraFields;

/**
 * Valid reset intervals for features.
 */
export type ResetType =
    | "hourly"
    | "6-hourly"
    | "daily"
    | "weekly"
    | "monthly"
    | "quarterly"
    | "yearly"
    | "never";

/**
 * Possible states when checking consumption limits.
 */
export type ConsumptionLimitType =
    | "in-limit"
    | "above-max-limit"
    | "below-min-limit";

/**
 * Options for configuring the usage plugin.
 *
 * - `features`: Required list of all trackable features.
 * - `overrides`: Optional per-customer or per-plan overrides.
 * - `customers`: Optional pre-registered customer dictionary.
 */
export interface UsageOptions {
    features: Features;
    overrides?: Overrides;
    customers?: Customers;
}

