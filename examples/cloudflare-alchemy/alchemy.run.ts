import alchemy from "alchemy"
import { Worker, DurableObjectNamespace } from "alchemy/cloudflare"

/**
 * Alchemy IaC for the Cloudflare-native usage setup. Run with:
 *   bun alchemy.run.ts          # deploy
 *   bun alchemy.run.ts --destroy
 *
 * No special plugin needed — the usage DO composes through alchemy's standard
 * DurableObjectNamespace + Worker primitives.
 */
const app = await alchemy("better-auth-usage-example")

// One Durable Object namespace; `className` must match the export in worker.ts.
// `sqlite: true` gives the DO transactional SQLite storage.
const usageDO = DurableObjectNamespace("usage", {
    className: "UsageDurableObject",
    sqlite: true,
})

export const worker = await Worker("api", {
    entrypoint: "./src/worker.ts",
    bindings: {
        USAGE_DO: usageDO,
        BASE_URL: "https://your-worker.workers.dev/api/auth",
        BETTER_AUTH_SECRET: alchemy.secret(process.env.BETTER_AUTH_SECRET),
        // DB: <D1 / Hyperdrive binding for the durable source of truth>
    },
})

console.log(`Deployed → ${worker.url}`)

await app.finalize()
