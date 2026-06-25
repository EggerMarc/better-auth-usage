/// <reference types="@cloudflare/workers-types" />

/** Worker bindings. `USAGE_DO` is the Durable Object namespace from alchemy. */
export interface Env {
    USAGE_DO: DurableObjectNamespace
    BASE_URL: string
    BETTER_AUTH_SECRET: string
}
