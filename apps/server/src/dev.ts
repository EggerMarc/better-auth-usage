import { makeAuth } from "@repo/auth"
import { memoryDriver } from "@repo/core/drivers/memory"
import { createFetch } from "./app"

// Bun dev entry — no Cloudflare runtime. In-memory driver with in-process
// realtime (Node WS server on :3009, every tab hits the same process so
// consumes broadcast live) + libsql file DB. `bun run --hot` serves this.
const auth = makeAuth(memoryDriver({ realtime: { port: 3009 } }))

export default {
    port: 3000,
    fetch: createFetch(auth),
}
