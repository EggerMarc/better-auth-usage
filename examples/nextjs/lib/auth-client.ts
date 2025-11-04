import { createAuthClient } from "better-auth/react"
import { usageClient } from "../../../dist/client"
import type { BetterAuthClientPlugin } from "better-auth"

export const authClient = createAuthClient({
    baseURL: process.env.BETTER_AUTH_URL!,
    plugins: [
        usageClient() as BetterAuthClientPlugin
    ]
})

