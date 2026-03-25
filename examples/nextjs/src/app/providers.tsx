"use client"

import { useState, useEffect, type ReactNode } from "react"
import { authClient } from "@/lib/auth-client"
import { UsageProvider } from "package/react"

export function Providers({ children }: { children: ReactNode }) {
    const session = authClient.useSession()
    const [ready, setReady] = useState(false)

    // Auto sign-in anonymously if no session
    useEffect(() => {
        if (session.data) return
        if (session.isPending) return

        authClient.signIn.anonymous()
    }, [session.data, session.isPending])

    if (!session.data?.user?.id) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
                <p className="text-sm text-zinc-400">Connecting...</p>
            </div>
        )
    }

    return (
        <UsageProvider
            baseURL="/api/auth"
            referenceId={session.data.user.id}
        >
            {children}
        </UsageProvider>
    )
}
