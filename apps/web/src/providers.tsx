import { useEffect, type ReactNode } from "react"
import { authClient, baseURL, createUsageProvider } from "@repo/auth/client"
import { DEFAULT_ROOM, REFERENCE_TYPE } from "./demo"

export const { UsageProvider, useFeature, useSetReference, useAllEvents } = createUsageProvider()

export function Providers({ children }: { children: ReactNode }) {
    const session = authClient.useSession()

    // Auto sign-in anonymously if no session.
    useEffect(() => {
        if (session.data || session.isPending) return
        authClient.signIn.anonymous().catch((err) => console.error("Anonymous sign-in failed:", err))
    }, [session.data, session.isPending])

    if (!session.data?.user?.id) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
                <p className="text-sm text-zinc-400">Connecting...</p>
            </div>
        )
    }

    // Start in the default room — every visitor in a room shares its counters.
    return (
        <UsageProvider referenceId={DEFAULT_ROOM} referenceType={REFERENCE_TYPE} baseURL={baseURL}>
            {children}
        </UsageProvider>
    )
}
