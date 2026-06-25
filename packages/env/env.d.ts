/// <reference types="@cloudflare/workers-types" />

// Worker object bindings. String config (CORS_ORIGIN, BETTER_AUTH_*, DATABASE_URL)
// is read via process.env (see src/server.ts); only object bindings live here.
declare namespace Cloudflare {
    interface Env {
        USAGE_DO: DurableObjectNamespace
    }
}
