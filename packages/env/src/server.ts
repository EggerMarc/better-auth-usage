/// <reference path="../env.d.ts" />
// On Cloudflare Workers, bindings are accessed via the `cloudflare:workers`
// module. Types come from env.d.ts (kept in sync with alchemy.run.ts bindings).
export { env } from "cloudflare:workers"
