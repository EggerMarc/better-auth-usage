import { createAuthClient } from "better-auth/react"
import { usageClient } from "../../../package/client.ts"
import type { BetterAuthClientPlugin, BetterAuthPlugin } from "better-auth"

export const authClient = createAuthClient({
    baseURL: process.env.BETTER_AUTH_URL!,
    plugins: [
        usageClient() as BetterAuthClientPlugin
    ]
})

export const { listFeatures, } = authClient;
