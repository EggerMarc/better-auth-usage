import { createAuthClient } from "better-auth/react"
import { anonymousClient } from "better-auth/client/plugins"
import { usageClient } from "package/client"

export const authClient = createAuthClient({
    baseURL: process.env.NEXT_PUBLIC_BETTER_AUTH_URL ?? "http://localhost:3002",
    plugins: [
        anonymousClient(),
        usageClient(),
    ]
})
