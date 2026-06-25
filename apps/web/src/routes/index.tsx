import { createFileRoute } from "@tanstack/react-router"
import { useState, useRef, useEffect } from "react"
import { authClient } from "@repo/auth/client"
import { useFeature, useAllEvents, useSetReference } from "../providers"

export const Route = createFileRoute("/")({ component: Home })

const FEATURES = [
    { key: "api-calls", label: "API Calls", icon: "GET", unit: "requests" },
    { key: "storage", label: "Storage", icon: "DB", unit: "MB" },
    { key: "credits", label: "Credits", icon: "CR", unit: "credits" },
] as const

function pct(current: number, max: number | null): number {
    if (max == null || max === 0) return 0
    return Math.min(100, Math.round((current / max) * 100))
}

function barColor(p: number): string {
    if (p >= 90) return "bg-red-500"
    if (p >= 75) return "bg-amber-500"
    return "bg-emerald-500"
}

function statusBadge(status: string | undefined) {
    if (!status) return { text: "Loading", cls: "bg-zinc-200 text-zinc-600" }
    if (status === "in-limit") return { text: "In Limit", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" }
    if (status === "above-max-limit") return { text: "Over Limit", cls: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" }
    return { text: "Below Min", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" }
}

function ts(epoch: number) {
    return new Date(epoch).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

function FeatureCard({ featureKey, label, icon, unit }: {
    featureKey: typeof FEATURES[number]["key"]
    label: string
    icon: string
    unit: string
}) {
    const { usage, consume } = useFeature(featureKey)
    const [loading, setLoading] = useState(false)

    const p = pct(usage?.current ?? 0, usage?.max ?? null)
    const badge = statusBadge(usage?.status)

    const action = async (fn: () => Promise<unknown>) => {
        setLoading(true)
        try { await fn() }
        catch (e) { console.error(`[${featureKey}] failed:`, e) }
        finally { setLoading(false) }
    }

    return (
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-100 text-[10px] font-bold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                        {icon}
                    </span>
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{label}</span>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.cls}`}>{badge.text}</span>
            </div>

            <div className="mb-2 flex items-baseline gap-1">
                <span className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{usage?.current ?? "—"}</span>
                <span className="text-sm text-zinc-400">/ {usage?.max ?? "—"} {unit}</span>
            </div>

            <div className="mb-1 h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div className={`h-full rounded-full transition-all duration-300 ${barColor(p)}`} style={{ width: `${p}%` }} />
            </div>
            <div className="mb-4 flex justify-between text-[10px] text-zinc-400">
                <span>{p}% used</span>
                <span>{usage?.remaining ?? "—"} remaining</span>
            </div>

            <div className="flex flex-wrap gap-1.5">
                {[1, 10, 100].map((n) => (
                    <button
                        key={n}
                        onClick={() => action(() => consume(n))}
                        disabled={loading}
                        className="rounded-md bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                    >
                        +{n}
                    </button>
                ))}
                <button
                    onClick={() => action(() => consume(-5))}
                    disabled={loading}
                    className="rounded-md bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-200 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                >
                    -5
                </button>
            </div>
        </div>
    )
}

function EventLog() {
    const events = useAllEvents()
    const endRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: "smooth" })
    }, [events.length])

    return (
        <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 md:col-span-2">
            <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
                <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Event Log</h2>
                <span className="text-[10px] text-zinc-400">{events.length} events</span>
            </div>
            <div className="h-64 overflow-y-auto px-4 py-2 font-mono text-xs">
                {events.length === 0 && (
                    <p className="py-8 text-center text-zinc-400">Interact with the features above to see events here</p>
                )}
                {events.slice(-50).map((entry, i) => (
                    <div key={i} className="flex gap-2 py-0.5">
                        <span className="shrink-0 text-zinc-400">{ts(entry.ts)}</span>
                        <span className={`shrink-0 ${entry.type === "consume" ? "text-blue-500" : "text-zinc-500"}`}>[{entry.type}]</span>
                        <span className="shrink-0 text-zinc-500 dark:text-zinc-400">{entry.feature}</span>
                        <span className="text-zinc-700 dark:text-zinc-300">
                            {entry.data?.current ?? "—"}/{entry.data?.max ?? "—"}
                            {entry.data?.status === "above-max-limit" && " OVER LIMIT"}
                        </span>
                        {entry.duration != null && <span className="text-blue-400">{entry.duration}ms</span>}
                    </div>
                ))}
                <div ref={endRef} />
            </div>
        </div>
    )
}

function AuthBar() {
    const session = authClient.useSession()
    const setReference = useSetReference()
    const [selectedPlan, setSelectedPlan] = useState<string | null>()
    const [switching, setSwitching] = useState(false)

    const user = session.data?.user
    const isAnonymous = (user as { isAnonymous?: boolean } | undefined)?.isAnonymous

    const handleSignOut = () => {
        authClient.signOut().then(() => window.location.reload())
    }

    const handlePlanSwitch = async (plan: string) => {
        if (!user?.id || switching) return
        setSwitching(true)
        setSelectedPlan(plan)
        try {
            await authClient.usage.upsertCustomer({ referenceId: user.id, referenceType: "user", overrideKey: plan })
            setReference(user.id, "user")
        } catch (e) {
            console.error("Plan switch failed:", e)
        } finally {
            setSwitching(false)
        }
    }

    return (
        <div className="flex items-center gap-3">
            {isAnonymous ? (
                <span className="text-xs text-zinc-400">Anonymous session</span>
            ) : (
                <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500">{user?.name ?? user?.email}</span>
                    <button onClick={handleSignOut} className="text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
                        Sign out
                    </button>
                </div>
            )}

            <div className="ml-2 flex items-center gap-1.5">
                <span className="text-[10px] text-zinc-400">Plan:</span>
                {["starter", "pro"].map((plan) => (
                    <button
                        key={plan}
                        onClick={() => handlePlanSwitch(plan)}
                        disabled={switching}
                        className={`rounded-full px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${selectedPlan === plan
                            ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                            : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                            }`}
                    >
                        {plan}
                    </button>
                ))}
            </div>
        </div>
    )
}

function Home() {
    return (
        <div className="min-h-screen bg-zinc-50 font-sans dark:bg-zinc-950">
            <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
                    <div>
                        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">better-auth-usage</h1>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400">Feature usage tracking, entitlements &amp; realtime state</p>
                    </div>
                    <AuthBar />
                </div>
            </header>

            <div className="mx-auto max-w-6xl px-6 py-8">
                <div className="grid gap-4 md:grid-cols-3">
                    {FEATURES.map((f) => (
                        <FeatureCard key={f.key} featureKey={f.key} label={f.label} icon={f.icon} unit={f.unit} />
                    ))}
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-3">
                    <EventLog />
                    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
                        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">How it works</h2>
                        <ul className="space-y-1 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                            <li>Anonymous session (auto)</li>
                            <li>Realtime state via WebSocket → Durable Object</li>
                            <li>Operations route through WS, REST fallback</li>
                            <li>Switch plans to see limits change instantly</li>
                            <li>Round-trip timing on every consume event</li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    )
}
