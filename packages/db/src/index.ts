/// <reference types="@cloudflare/workers-types" />
import { drizzle } from "drizzle-orm/d1"
import * as schema from "./schema/auth"

/**
 * Drizzle client bound to a D1 database. The binding is INJECTED (not imported
 * from `cloudflare:workers`) so this package loads anywhere — the Worker passes
 * `env.DB`, the better-auth CLI passes a stub (generate never queries).
 */
export function createDb(d1: D1Database) {
    return drizzle(d1, { schema })
}

export type DB = ReturnType<typeof createDb>
