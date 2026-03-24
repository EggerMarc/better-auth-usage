"use client"

import { authClient, createUsageTracker } from "@/lib/auth-client"
import { useCallback, useEffect, useRef, useState } from "react"
import type { UsageState, ThresholdEvent, BlockedEvent } from "package/client"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const usage = (authClient as any).usage as Record<string, (...args: any[]) => Promise<any>>

// ── Types ──

type LogEntry = {
    id: number
    time: string
    type: "info" | "threshold" | "blocked" | "error" | "speed"
    message: string
}

type FeatureKey = "api-calls" | "storage" | "credits"

const FEATURES: { key: FeatureKey; label: string; icon: string; unit: string }[] = [
    { key: "api-calls", label: "API Calls", icon: "GET", unit: "requests" },
    { key: "storage", label: "Storage", icon: "DB", unit: "MB" },
    { key: "credits", label: "Credits", icon: "CR", unit: "credits" },
]

const REF_ID = "demo-user"

// ── Helpers ──

function pct(state: UsageState | null): number {
    if (!state || state.max == null || state.max === 0) return 0
    return Math.min(100, Math.round((state.current / state.max) * 100))
}

function barColor(p: number): string {
    if (p >= 90) return "bg-red-500"
    if (p >= 75) return "bg-amber-500"
    return "bg-emerald-500"
}

function statusBadge(state: UsageState | null) {
    if (!state) return { text: "Unknown", cls: "bg-zinc-200 text-zinc-600" }
    if (state.status === "in-limit") return { text: "In Limit", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" }
    if (state.status === "above-max-limit") return { text: "Over Limit", cls: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" }
    return { text: "Below Min", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" }
}

function ts() {
    return new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

// ── Page ──

export default function Home() {
    const [usageStates, setUsageStates] = useState<Record<string, UsageState>>({})
    const [logs, setLogs] = useState<LogEntry[]>([])
    const [loading, setLoading] = useState<Record<string, boolean>>({})
    const [selectedPlan, setSelectedPlan] = useState<string>("starter")
    const logIdRef = useRef(0)
    const logsEndRef = useRef<HTMLDivElement>(null)

    const addLog = useCallback((type: LogEntry["type"], message: string) => {
        setLogs(prev => {
            const next = [...prev, { id: ++logIdRef.current, time: ts(), type, message }]
            return next.slice(-50) // keep last 50
        })
    }, [])

    // ── Reactive Tracker ──
    useEffect(() => {
        const tracker = createUsageTracker({
            baseURL: "/api/auth",
            websocket: true,
            wsUrl: "http://localhost:3178", // Socket.IO server
            pollInterval: 3000,
            thresholds: [0.5, 0.75, 0.9, 1.0],
        })

        const handle = tracker.track({
            referenceId: REF_ID,
            features: FEATURES.map(f => f.key),
        })

        handle.on("update", (state) => {
            setUsageStates({ ...state })
        })

        handle.on("threshold", (e: ThresholdEvent) => {
            addLog("threshold", `${e.feature} crossed ${Math.round(e.threshold * 100)}% threshold (${e.current}/${e.max})`)
        })

        handle.on("blocked", (e: BlockedEvent) => {
            addLog("blocked", `${e.feature} is now BLOCKED (${e.current}/${e.max})`)
        })

        addLog("info", "Reactive tracker connected — polling every 3s")

        return () => handle.dispose()
    }, [addLog])

    // ── Actions ──

    const timed = async <T,>(label: string, fn: () => Promise<T>): Promise<T> => {
        const start = performance.now()
        const result = await fn()
        const ms = (performance.now() - start).toFixed(1)
        addLog("speed", `${label} completed in ${ms}ms`)
        return result
    }

    // Helper: update a single feature's card state from an API response
    const updateCard = (featureKey: string, d: any) => {
        if (!d || d.current == null) return
        setUsageStates(prev => ({
            ...prev,
            [featureKey]: {
                current: d.current ?? d.currentAmount ?? 0,
                max: d.max ?? d.maxLimit ?? null,
                min: d.min ?? d.minLimit ?? null,
                remaining: d.remaining ?? null,
                percent: d.percent ?? null,
                status: d.status ?? "in-limit",
                allowed: d.allowed ?? d.status === "in-limit",
            },
        }))
    }

    const handleConsume = async (featureKey: FeatureKey, amount: number) => {
        setLoading(prev => ({ ...prev, [featureKey]: true }))
        try {
            // useFeature checks limit before consuming — blocks if over limit
            const res = await timed(`useFeature(${featureKey}, ${amount > 0 ? "+" : ""}${amount})`, () =>
                usage.useFeature({
                    referenceId: REF_ID,
                    featureKey,
                    amount,
                })
            )
            const d = res?.data ?? res
            if (d.allowed === false) {
                addLog("blocked", `Blocked: ${featureKey} is over limit (${d.current}/${d.max})`)
            } else {
                addLog("info", `Consumed ${amount > 0 ? "+" : ""}${amount} on ${featureKey} — current: ${d.current}`)
            }
            updateCard(featureKey, d)
        } catch (e: any) {
            addLog("error", `consume(${featureKey}) failed: ${e.message ?? e}`)
        } finally {
            setLoading(prev => ({ ...prev, [featureKey]: false }))
        }
    }

    const handleRefund = async (featureKey: FeatureKey, amount: number) => {
        setLoading(prev => ({ ...prev, [featureKey]: true }))
        try {
            const res = await timed(`refund(${featureKey}, -${amount})`, () =>
                usage.consume({
                    referenceId: REF_ID,
                    featureKey,
                    amount: -amount,
                    event: "refund",
                })
            )
            const d = res?.data ?? res
            addLog("info", `Refunded -${amount} on ${featureKey} — current: ${d.current}`)
            updateCard(featureKey, d)
        } catch (e: any) {
            addLog("error", `refund(${featureKey}) failed: ${e.message ?? e}`)
        } finally {
            setLoading(prev => ({ ...prev, [featureKey]: false }))
        }
    }

    const handleUseFeature = async (featureKey: FeatureKey) => {
        setLoading(prev => ({ ...prev, [`use-${featureKey}`]: true }))
        try {
            const res = await timed(`useFeature(${featureKey})`, () =>
                usage.useFeature({
                    referenceId: REF_ID,
                    featureKey,
                })
            )
            const d = res?.data ?? res
            addLog("info", `useFeature(${featureKey}) — allowed: ${d.allowed}, current: ${d.current}`)
            updateCard(featureKey, d)
        } catch (e: any) {
            addLog("error", `useFeature(${featureKey}) failed: ${e.message ?? e}`)
        } finally {
            setLoading(prev => ({ ...prev, [`use-${featureKey}`]: false }))
        }
    }

    const handleCanUse = async (featureKey: FeatureKey) => {
        try {
            const res = await timed(`canUse(${featureKey})`, () =>
                usage.canUse({
                    referenceId: REF_ID,
                    featureKey,
                })
            )
            const d = res?.data ?? res
            addLog("info", `canUse(${featureKey}) — allowed: ${d.allowed}, status: ${d.status}, remaining: ${d.remaining}`)
            updateCard(featureKey, d)
        } catch (e: any) {
            addLog("error", `canUse(${featureKey}) failed: ${e.message ?? e}`)
        }
    }

    const handleCheck = async (featureKey: FeatureKey) => {
        try {
            const res = await timed(`check(${featureKey})`, () =>
                usage.check({
                    referenceId: REF_ID,
                    featureKey,
                })
            )
            const d = res?.data ?? res
            addLog("info", `check(${featureKey}) — current: ${d.current}, max: ${d.max}, percent: ${d.percent}%`)
            updateCard(featureKey, d)
        } catch (e: any) {
            addLog("error", `check(${featureKey}) failed: ${e.message ?? e}`)
        }
    }

    const handleListFeatures = async () => {
        try {
            const res = await timed("listFeatures()", () =>
                usage.listFeatures()
            )
            const features = res?.data ?? res
            const list = Array.isArray(features) ? features : []
            addLog("info", `listFeatures() — ${list.length} features: ${list.map((f: any) => f.featureKey ?? f.key).join(", ")}`)
        } catch (e: any) {
            addLog("error", `listFeatures() failed: ${e.message ?? e}`)
        }
    }

    const handleSetPlan = async (plan: string) => {
        setSelectedPlan(plan)
        try {
            await timed(`upsertCustomer(plan=${plan})`, () =>
                usage.upsertCustomer({
                    referenceId: REF_ID,
                    referenceType: "user",
                    overrideKey: plan,
                })
            )
            addLog("info", `Customer plan set to "${plan}" — refreshing limits...`)

            // Refresh all feature cards to show new limits
            for (const f of FEATURES) {
                try {
                    const res = await usage.check({
                        referenceId: REF_ID,
                        featureKey: f.key,
                    })
                    const d = (res as any)?.data ?? res
                    updateCard(f.key, d)
                } catch { /* ignore */ }
            }
            addLog("info", `Limits updated for plan "${plan}"`)
        } catch (e: any) {
            addLog("error", `upsertCustomer failed: ${e.message ?? e}`)
        }
    }

    // ── Scroll logs ──
    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }, [logs])

    // ── Render ──

    return (
        <div className="min-h-screen bg-zinc-50 font-sans dark:bg-zinc-950">
            {/* Header */}
            <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
                    <div>
                        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                            better-auth-usage
                        </h1>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400">
                            Feature usage tracking, entitlements & realtime state
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="text-xs text-zinc-400">Plan:</span>
                        {["starter", "pro"].map(plan => (
                            <button
                                key={plan}
                                onClick={() => handleSetPlan(plan)}
                                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                                    selectedPlan === plan
                                        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                                        : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                                }`}
                            >
                                {plan}
                            </button>
                        ))}
                    </div>
                </div>
            </header>

            <div className="mx-auto max-w-6xl px-6 py-8">
                {/* Feature Cards */}
                <div className="grid gap-4 md:grid-cols-3">
                    {FEATURES.map(feature => {
                        const state = usageStates[feature.key]
                        const p = pct(state)
                        const badge = statusBadge(state)

                        return (
                            <div
                                key={feature.key}
                                className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
                            >
                                {/* Header */}
                                <div className="mb-4 flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-100 text-[10px] font-bold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                                            {feature.icon}
                                        </span>
                                        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                            {feature.label}
                                        </span>
                                    </div>
                                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.cls}`}>
                                        {badge.text}
                                    </span>
                                </div>

                                {/* Usage numbers */}
                                <div className="mb-2 flex items-baseline gap-1">
                                    <span className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                                        {state?.current ?? "—"}
                                    </span>
                                    <span className="text-sm text-zinc-400">
                                        / {state?.max ?? "—"} {feature.unit}
                                    </span>
                                </div>

                                {/* Progress bar */}
                                <div className="mb-1 h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                                    <div
                                        className={`h-full rounded-full transition-all duration-300 ${barColor(p)}`}
                                        style={{ width: `${p}%` }}
                                    />
                                </div>
                                <div className="mb-4 flex justify-between text-[10px] text-zinc-400">
                                    <span>{p}% used</span>
                                    <span>{state?.remaining ?? "—"} remaining</span>
                                </div>

                                {/* Actions */}
                                <div className="flex flex-wrap gap-1.5">
                                    <button
                                        onClick={() => handleConsume(feature.key, 1)}
                                        disabled={!!loading[feature.key]}
                                        className="rounded-md bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                                    >
                                        +1
                                    </button>
                                    <button
                                        onClick={() => handleConsume(feature.key, 10)}
                                        disabled={!!loading[feature.key]}
                                        className="rounded-md bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                                    >
                                        +10
                                    </button>
                                    <button
                                        onClick={() => handleRefund(feature.key, 5)}
                                        disabled={!!loading[feature.key]}
                                        className="rounded-md bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-200 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                                    >
                                        -5
                                    </button>
                                    <button
                                        onClick={() => handleUseFeature(feature.key)}
                                        disabled={!!loading[`use-${feature.key}`]}
                                        className="rounded-md border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                                    >
                                        useFeature
                                    </button>
                                    <button
                                        onClick={() => handleCanUse(feature.key)}
                                        className="rounded-md border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                                    >
                                        canUse
                                    </button>
                                    <button
                                        onClick={() => handleCheck(feature.key)}
                                        className="rounded-md border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                                    >
                                        check
                                    </button>
                                </div>
                            </div>
                        )
                    })}
                </div>

                {/* Bottom row: Event Log + Quick Actions */}
                <div className="mt-6 grid gap-4 md:grid-cols-3">
                    {/* Event Log — spans 2 columns */}
                    <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 md:col-span-2">
                        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
                            <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Event Log</h2>
                            <button
                                onClick={() => setLogs([])}
                                className="text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                            >
                                Clear
                            </button>
                        </div>
                        <div className="h-64 overflow-y-auto px-4 py-2 font-mono text-xs">
                            {logs.length === 0 && (
                                <p className="py-8 text-center text-zinc-400">
                                    Interact with the features above to see events here
                                </p>
                            )}
                            {logs.map(log => (
                                <div key={log.id} className="flex gap-2 py-0.5">
                                    <span className="shrink-0 text-zinc-400">{log.time}</span>
                                    <span className={`shrink-0 ${
                                        log.type === "speed" ? "text-blue-500" :
                                        log.type === "threshold" ? "text-amber-500" :
                                        log.type === "blocked" ? "text-red-500" :
                                        log.type === "error" ? "text-red-400" :
                                        "text-zinc-500"
                                    }`}>
                                        [{log.type}]
                                    </span>
                                    <span className="text-zinc-700 dark:text-zinc-300">{log.message}</span>
                                </div>
                            ))}
                            <div ref={logsEndRef} />
                        </div>
                    </div>

                    {/* Quick Actions */}
                    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
                        <h2 className="mb-4 text-sm font-medium text-zinc-900 dark:text-zinc-100">Quick Actions</h2>
                        <div className="flex flex-col gap-2">
                            <button
                                onClick={handleListFeatures}
                                className="w-full rounded-lg bg-zinc-100 px-3 py-2 text-left text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                            >
                                List all features
                            </button>
                            <button
                                onClick={async () => {
                                    for (const f of FEATURES) {
                                        await handleConsume(f.key, 25)
                                    }
                                }}
                                className="w-full rounded-lg bg-zinc-100 px-3 py-2 text-left text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                            >
                                Bulk consume +25 all
                            </button>
                            <button
                                onClick={async () => {
                                    const start = performance.now()
                                    const promises = FEATURES.map(f =>
                                        usage.check({ referenceId: REF_ID, featureKey: f.key })
                                    )
                                    await Promise.all(promises)
                                    const ms = (performance.now() - start).toFixed(1)
                                    addLog("speed", `Parallel check (${FEATURES.length} features) in ${ms}ms`)
                                }}
                                className="w-full rounded-lg bg-zinc-100 px-3 py-2 text-left text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                            >
                                Speed test: parallel check all
                            </button>
                            <button
                                onClick={async () => {
                                    const start = performance.now()
                                    for (let i = 0; i < 10; i++) {
                                        await usage.consume({
                                            referenceId: REF_ID,
                                            featureKey: "api-calls",
                                            amount: 1,
                                        })
                                    }
                                    const ms = (performance.now() - start).toFixed(1)
                                    addLog("speed", `Sequential 10x consume in ${ms}ms (avg ${(parseFloat(ms) / 10).toFixed(1)}ms/op)`)
                                }}
                                className="w-full rounded-lg bg-zinc-100 px-3 py-2 text-left text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                            >
                                Speed test: 10x sequential consume
                            </button>
                        </div>

                        <div className="mt-4 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/50">
                            <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                                How it works
                            </h3>
                            <ul className="space-y-1 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                                <li>Redis atomic Lua scripts for sub-10ms writes</li>
                                <li>WAL for durable event sourcing to DB</li>
                                <li>Reactive tracker polls / connects via WebSocket</li>
                                <li>Threshold & blocked events fire automatically</li>
                                <li>Plan overrides change limits instantly</li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
