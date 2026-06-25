import { createAuthClient } from "better-auth/react"
import { anonymousClient } from "better-auth/client/plugins"
import { usageClient } from "@repo/core/client"
import { env } from "@repo/env/web"

// The auth + usage client deps live here so apps consume a ready client from
// `@repo/auth/client` instead of importing better-auth / the plugin directly.

export const baseURL = `${env.VITE_SERVER_URL}/api/auth`

export const authClient = createAuthClient({
    baseURL,
    plugins: [anonymousClient(), usageClient()],
})

export { createUsageProvider } from "@repo/core/react"
export type { UsageState, ConsumeResult, UsageEvent } from "@repo/core/react"
