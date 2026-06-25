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
            // The driver decides whether realtime is reachable and at what URL.
            return endpointOptions.driver.realtime?.endpointInfo(ctx.context.baseURL)
                ?? { enabled: false, url: null }
        }
    )
}
