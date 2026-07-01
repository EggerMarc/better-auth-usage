import { makeAuth } from "./index"
import { createDb } from "@repo/db"
import { memoryDriver } from "@eggermarc/better-auth-usage/drivers/memory"

// Node-loadable auth for the better-auth CLI (`generate`). Memory driver (no
// cloudflare:workers) + a stub D1 (generate reads the schema from config, never
// queries the database).
export const auth = makeAuth(memoryDriver(), createDb({} as D1Database))
