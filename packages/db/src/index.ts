import { drizzle } from "drizzle-orm/d1"
import { env } from "@repo/env/server"
import * as schema from "./schema/auth"

/** Drizzle client bound to the D1 database (one per request on Workers). */
export function createDb() {
    return drizzle(env.DB, { schema })
}
