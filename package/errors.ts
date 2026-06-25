import { Data } from "effect"

export class FeatureNotFound extends Data.TaggedError("FeatureNotFound")<{
    featureKey: string
}> {}

export class CustomerNotFound extends Data.TaggedError("CustomerNotFound")<{
    referenceId: string
}> {}

export class DbError extends Data.TaggedError("DbError")<{
    cause: unknown
    operation: string
}> {}

export class DriverError extends Data.TaggedError("DriverError")<{
    cause: unknown
    operation: string
}> {}

export class LimitExceeded extends Data.TaggedError("LimitExceeded")<{
    featureKey: string
    current: number
    limit: number
}> {}

export class ValidationError extends Data.TaggedError("ValidationError")<{
    message: string
}> {}

export class PlanChangeError extends Data.TaggedError("PlanChangeError")<{
    referenceId: string
    fromPlan: string | undefined
    toPlan: string
    cause: unknown
}> {}

export class NotAuthorized extends Data.TaggedError("NotAuthorized")<{
    userId: string
    referenceId: string
    feature: string
}> {}
