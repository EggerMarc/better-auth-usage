"use client"

import { useEffect, type ReactNode } from "react"
import { authClient } from "@/lib/auth-client"
import { createUsageProvider } from "package/react"
import type { auth } from "@/lib/auth"

export const { UsageProvider, useFeature, useSetReference, useAllEvents } = createUsageProvider<typeof auth>()

export function Providers({ children }: { children: ReactNode }) {
    const session = authClient.useSession()

    // Auto sign-in anonymously if no session, then assign starter plan
    useEffect(() => {
        if (session.data) return
        if (session.isPending) return

        authClient.signIn.anonymous()
            .catch((err) => console.error("Anonymous sign-in failed:", err))
    }, [session.data, session.isPending])

    if (!session.data?.user?.id) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
                <p className="text-sm text-zinc-400">Connecting...</p>
            </div>
        )
    }

    return (
        <UsageProvider referenceId={session.data.user.id}>
            {children}
        </UsageProvider>
    )
}
