import { createAuthClient } from "better-auth/react"
import { anonymousClient } from "better-auth/client/plugins"
import { usageClient } from "@eggermarc/better-auth-usage/client"

export const authClient = createAuthClient({
    baseURL: "http://localhost:3002",
    plugins: [
        anonymousClient(),
        usageClient(),
    ]
})
