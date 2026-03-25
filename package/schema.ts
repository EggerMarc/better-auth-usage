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
