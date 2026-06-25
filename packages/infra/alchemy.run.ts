import alchemy from "alchemy"
import { Worker, Vite, DurableObjectNamespace } from "alchemy/cloudflare"
import { env } from "@repo/env/infra"

const app = await alchemy("better-auth-usage")

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
    // Populate process.env from text bindings so @repo/env (t3) can read them.
    compatibilityFlags: ["nodejs_compat_populate_process_env"],
    url: true,
    bindings: {
        USAGE_DO: usageDO,
        DATABASE_URL: env.DATABASE_URL,
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
