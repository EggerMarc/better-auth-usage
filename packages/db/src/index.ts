import { drizzle } from "drizzle-orm/libsql"
import { createClient } from "@libsql/client"
import { env } from "@repo/env/server"
import * as schema from "./schema/auth"

const client = createClient({ url: env.DATABASE_URL })

export const db = drizzle(client, { schema })
