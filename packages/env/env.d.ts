/// <reference types="@cloudflare/workers-types" />

// Worker object bindings. String config (CORS_ORIGIN, BETTER_AUTH_*) is read
// via process.env (see src/server.ts); object bindings live here.
declare namespace Cloudflare {
    interface Env {
        DB: D1Database
        USAGE_DO: DurableObjectNamespace
    }
}
