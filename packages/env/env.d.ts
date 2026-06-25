/// <reference types="@cloudflare/workers-types" />

// Worker bindings — mirror packages/infra/alchemy.run.ts. The DO namespace
// holds the usage counters + realtime WebSocket connections.
declare module "cloudflare:workers" {
    interface Env {
        DB: D1Database
        USAGE_DO: DurableObjectNamespace
        CORS_ORIGIN: string
        BETTER_AUTH_SECRET: string
        BETTER_AUTH_URL: string
    }
    export const env: Env
}
