import { durableObjectDriver, mountUsage } from "@repo/core/cloudflare"
import { makeAuth } from "@repo/auth"
import { env as cf } from "cloudflare:workers"
import { createFetch } from "./app"

// Worker entry (deployed). Export the DO class so the runtime can instantiate
// it; bound as USAGE_DO in apps/server/wrangler.jsonc + packages/infra.
export { UsageDurableObject } from "@repo/core/cloudflare"

const USAGE_DO = (cf as { USAGE_DO: DurableObjectNamespace }).USAGE_DO
const auth = makeAuth(durableObjectDriver({ namespace: USAGE_DO }))

export default {
    fetch: createFetch(auth, (req) => mountUsage(req, { namespace: USAGE_DO, auth })),
}
