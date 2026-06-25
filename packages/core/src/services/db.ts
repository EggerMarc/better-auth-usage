import { Context, Effect } from "effect"
import { DbError } from "../errors"
import type { AuthContext } from "better-auth"

/**
 * DbService interface — wraps BetterAuth's adapter.
 *
 * BetterAuth provides a database adapter (Drizzle, Prisma, etc.)
 * via the AuthContext. This service wraps it with typed Effect errors.
 */
export interface DbService {
    findOne<T>(params: {
        model: string,
        where: Array<{ field: string, value: string }>
    }): Effect.Effect<T | null, DbError>

    findMany<T>(params: {
        model: string,
        where: Array<{ field: string, value: string }>,
        sortBy?: { field: string, direction: "asc" | "desc" }
    }): Effect.Effect<T[], DbError>

    create<T>(params: {
        model: string,
        data: Record<string, unknown>
    }): Effect.Effect<T, DbError>

    update<T>(params: {
        model: string,
        where: Array<{ field: string, value: string }>,
        update: Record<string, unknown>
    }): Effect.Effect<T, DbError>

    /** Run multiple operations in a single DB transaction */
    transaction<R>(fn: (tx: DbService) => Effect.Effect<R, DbError>): Effect.Effect<R, DbError>
}

export const DbService = Context.GenericTag<DbService>("DbService")

/**
 * Wrap a BetterAuth adapter call in a typed Effect.
 */
const wrapDb = <T>(operation: string, fn: () => Promise<T>): Effect.Effect<T, DbError> =>
    Effect.tryPromise({
        try: fn,
        catch: (cause) => new DbError({ cause, operation }),
    })

/**
 * Create a DbService from a BetterAuth AuthContext.
 *
 * Called per-request since BetterAuth provides the adapter via context.
 * Unlike the driver (long-lived), this is created fresh per endpoint call.
 */
const makeDbServiceFromAdapter = (adapter: any): DbService => ({
    findOne: (params) =>
        wrapDb("findOne", () => adapter.findOne(params)),

    findMany: (params) =>
        wrapDb("findMany", () => adapter.findMany(params)),

    create: (params) =>
        wrapDb("create", () => adapter.create(params)),

    update: (params) =>
        wrapDb("update", () => adapter.update(params)),

    transaction: (fn) =>
        adapter.transaction
            ? wrapDb("transaction", () =>
                adapter.transaction((trx: any) =>
                    Effect.runPromise(fn(makeDbServiceFromAdapter(trx)))
                )
            )
            // No transaction support — run sequentially
            : fn(makeDbServiceFromAdapter(adapter)),
})

export const makeDbService = (ctx: AuthContext): DbService =>
    makeDbServiceFromAdapter(ctx.adapter)
