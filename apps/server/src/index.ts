import { durableObjectDriver, mountUsage } from "@eggermarc/better-auth-usage/cloudflare"
import { makeAuth } from "@repo/auth"
import { createDb } from "@repo/db"
import { env as cf } from "cloudflare:workers"
import { createFetch } from "./app"

// Worker entry — runs under wrangler dev (local D1 + DO) and on deploy. Export
// the DO class so the runtime can instantiate it (bound as USAGE_DO).
export { UsageDurableObject } from "@eggermarc/better-auth-usage/cloudflare"

const env = cf as { USAGE_DO: DurableObjectNamespace; DB: D1Database }
const auth = makeAuth(durableObjectDriver({ namespace: env.USAGE_DO }), createDb(env.DB))

export default {
    fetch: createFetch(auth, (req) => mountUsage(req, { namespace: env.USAGE_DO, auth })),
}
