import alchemy from "alchemy"
import { Worker, Vite, D1Database, DurableObjectNamespace } from "alchemy/cloudflare"
import { env } from "@repo/env/infra"

const app = await alchemy("better-auth-usage")

const db = await D1Database("database", {
    migrationsDir: "../../packages/db/src/migrations",
})

// One Durable Object per referenceId — holds the usage counter + realtime
// WebSocket connections. `className` matches the export in apps/server.
const usageDO = DurableObjectNamespace("usage", {
    className: "UsageDurableObject",
    sqlite: true,
})

export const server = await Worker("server", {
    cwd: "../../apps/server",
    entrypoint: "src/index.ts",
    compatibility: "node",
    url: true,
    bindings: {
        DB: db,
        USAGE_DO: usageDO,
        CORS_ORIGIN: env.CORS_ORIGIN,
        BETTER_AUTH_SECRET: alchemy.secret(env.BETTER_AUTH_SECRET),
        BETTER_AUTH_URL: env.BETTER_AUTH_URL,
    },
    dev: { port: 3000 },
})

export const web = await Vite("web", {
    cwd: "../../apps/web",
    assets: "dist",
    bindings: {
        VITE_SERVER_URL: server.url!,
    },
})

console.log(`Server -> ${server.url}`)
console.log(`Web    -> ${web.url}`)

await app.finalize()
