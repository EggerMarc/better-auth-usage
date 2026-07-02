import { Schema } from "@effect/schema"

// ── Core schemas ──

export const CustomerSchema = Schema.Struct({
    referenceId: Schema.String,
    referenceType: Schema.String,
    email: Schema.optional(Schema.String),
    name: Schema.optional(Schema.String),
    overrideKey: Schema.optional(Schema.String),
})

export const UsageSchema = Schema.Struct({
    referenceId: Schema.String,
    feature: Schema.String,
    amount: Schema.Number,
    event: Schema.optional(Schema.String),
    createdAt: Schema.DateFromSelf,
    lastResetAt: Schema.DateFromSelf,
    updatedAt: Schema.optional(Schema.DateFromSelf),
})

export const UsageEventSchema = Schema.Struct({
    referenceId: Schema.String,
    feature: Schema.String,
    amount: Schema.Number,
    event: Schema.String,
    overrideKey: Schema.optional(Schema.String),
    lastResetAt: Schema.DateFromSelf,
    createdAt: Schema.DateFromSelf,
})

// ── Cache schemas ──

export const CachedUsageSchema = Schema.Struct({
    referenceId: Schema.String,
    feature: Schema.String,
    current: Schema.Number,
    lastResetAt: Schema.NullOr(Schema.DateFromSelf),
    maxLimit: Schema.optional(Schema.Number),
    minLimit: Schema.optional(Schema.Number),
})

export const CachedLimitsSchema = Schema.Struct({
    referenceId: Schema.String,
    feature: Schema.String,
    maxLimit: Schema.optional(Schema.Number),
    minLimit: Schema.optional(Schema.Number),
    resetValue: Schema.optional(Schema.Number),
    lastResetAt: Schema.optional(Schema.DateFromSelf),
    resetAt: Schema.optional(Schema.DateFromSelf),
})

export const CachedUsageEventSchema = Schema.Struct({
    referenceId: Schema.String,
    feature: Schema.String,
    amount: Schema.Number,
    event: Schema.optional(Schema.String),
})

// ── Driver schemas ──

/** Args handed to a driver's atomic `consume` op (rules already resolved upstream). */
export const ConsumeArgsSchema = Schema.Struct({
    referenceId: Schema.String,
    feature: Schema.String,
    amount: Schema.Number,
    nowMs: Schema.Number,
    event: Schema.String,
    // Optional reset/limit config. Lets co-located drivers (Durable Object,
    // in-memory) self-prime their meta and apply reset boundaries atomically
    // during consume — so the consume pipeline no longer needs a preceding
    // getUsage/hydrate round-trip just to seed the counter's limits. Drivers
    // that prime meta by other means (redis Lua) may ignore these.
    resetValue: Schema.optional(Schema.Number),
    resetAt: Schema.optional(Schema.Number),   // epoch ms of the next reset boundary
    maxLimit: Schema.optional(Schema.Number),
    minLimit: Schema.optional(Schema.Number),
})

/** A driver `consume` return — mirrors the increment.lua contract. */
export const ConsumeOutcomeSchema = Schema.Struct({
    newTotal: Schema.Number,
    resetOccurred: Schema.Boolean,
    lastResetAt: Schema.Number,
})
