import { makeAuth } from "@repo/auth"
import { memoryDriver } from "@repo/core/drivers/memory"
import { createFetch } from "./app"

// Bun dev entry — no Cloudflare runtime. Uses the in-memory driver (realtime
// degrades to polling) + libsql file DB. `bun run --hot` serves this export.
const auth = makeAuth(memoryDriver())

export default {
    port: 3000,
    fetch: createFetch(auth),
}
