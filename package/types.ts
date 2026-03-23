import { Schema } from "@effect/schema"
import { UsageSchema, UsageEventSchema, CustomerSchema } from "./schema.ts"

/**
 * Usage snapshot — one row per (referenceId, feature).
 */
export type Usage = Schema.Schema.Type<typeof UsageSchema>;
export type UsageEvent = Schema.Schema.Type<typeof UsageEventSchema>;

/**
 * Generic key/value store for extending base types
 * with arbitrary string fields.
 */
type ExtraFields = {
    [key: string]: string;
};

/**
 * Customer specific usage limits
 * E.g.: Purchased credits
 */
export type CustomerLimits = {
    referenceId: string
    featureKey: string
    maxLimit?: number
    minLimit?: number
};

/**
 * Core Customer type used across the plugin.
 *
 * - `referenceId`: Unique ID of the customer (e.g. UUID, tenant ID).
 * - `referenceType`: Logical grouping or type of reference (e.g. "org", "user").
 * - `email` / `name`: Optional metadata for identification.
 *
 */
export type Customer = Schema.Schema.Type<typeof CustomerSchema>

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
     * Behavior when a customer's plan (overrideKey) changes.
     * - "carry-over" (default): usage stays, only limits change
     * - "reset": usage resets to resetValue on plan change
     */
    onPlanChange?: "carry-over" | "reset";

    /**
     * Optional authorization function that decides if a given
     * customer is allowed to consume this feature.
     */
    authorizeReference?: (params: {
        feature: string;
        referenceId: string;
        referenceType: string;
        incomingId: string;
    }) => Promise<boolean> | boolean;
};

/**
 * Dictionary of features keyed by their unique `key`.
 */
export type Features = Record<string, Feature>;

/**
 * Extract feature keys as a union type from a UsageOptions config.
 *
 * usage({ features: { "api-calls": {...}, "credits": {...} } })
 *   → InferFeatureKeys = "api-calls" | "credits"
 */
export type InferFeatureKeys<O extends UsageOptions> = keyof O["features"] & string;

/**
 * Extract override keys as a union type from a UsageOptions config.
 */
export type InferOverrideKeys<O extends UsageOptions> = O["overrides"] extends Record<string, any>
    ? keyof O["overrides"] & string
    : never;

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
 *   "starter-plan": {
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
    cacheOptions?: {
        enableRealtime?: boolean,
        redisUrl: string;
        port?: number;
        cors?: {
            origin: string | string[];
            credentials?: boolean;
        };
        wal?: {
            /** Enable WAL for durable Redis→DB sync. Default: true */
            enabled?: boolean;
            /** "subscribe" (default, zero idle cost) or "poll" (sends ~4 cmds/sec when idle) */
            drainStrategy?: "subscribe" | "poll";
            /** Poll interval in ms. Only used when drainStrategy is "poll". Default: 1000 */
            pollInterval?: number;
        };
    },
    logger?: {
        debug?(message: string, context?: Record<string, unknown>): void;
        info?(message: string, context?: Record<string, unknown>): void;
        warn?(message: string, context?: Record<string, unknown>): void;
        error?(message: string, context?: Record<string, unknown>): void;
    },
}
