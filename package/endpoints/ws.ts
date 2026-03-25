import { createAuthEndpoint, sessionMiddleware } from "better-auth/api"
import type { ResolvedUsageOptions } from "@/types"

export function getWsEndpoint(endpointOptions: ResolvedUsageOptions) {
    return createAuthEndpoint(
        "/usage/ws",
        {
            method: "GET",
            use: [sessionMiddleware],
        },
        async (ctx) => {
            const port = endpointOptions.cacheOptions?.port
            const enabled = endpointOptions.cacheOptions?.enableRealtime

            if (!enabled || !port) {
                return { enabled: false, url: null }
            }

            // Derive WS URL from the server's baseURL + configured port
            const baseURL = ctx.context.baseURL
            const origin = new URL(baseURL).origin
            const wsOrigin = origin.replace(/:\d+$/, "") + ":" + port

            return { enabled: true, url: wsOrigin }
        }
    )
}
