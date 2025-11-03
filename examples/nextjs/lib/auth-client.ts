import { createAuthClient } from "better-auth/react"
import { usageClient } from "../../../package/client.ts"

export const authClient = createAuthClient({
    baseURL: process.env.BETTER_AUTH_URL!,
    plugins: [
        usageClient()
    ]
})

