"use client"

import React, {
    createContext,
    useContext,
    useRef,
    useEffect,
    useCallback,
    useState,
    useSyncExternalStore,
    type ReactNode,
} from "react"
import {
    createUsageTracker,
    type UsageTrackerHandle,
    type UsageState,
    type ConsumeResult,
    type LogEntry,
} from "../client"

// ── Context ──

interface UsageContextValue {
    handle: UsageTrackerHandle | null
    referenceId: string
    referenceType: string
    setReference: (referenceId: string, referenceType?: string) => void
    registerFeature: (feature: string) => void
}

const UsageContext = createContext<UsageContextValue | null>(null)

// ── Provider ──

export interface UsageProviderProps {
    children: ReactNode
    /** Base URL of the BetterAuth server (e.g. "http://localhost:3000/api/auth") */
    baseURL: string
    /** Reference ID to track usage for. Can be changed via `useSetReference()`. */
    referenceId: string
    /** Reference type. Default: "user" */
    referenceType?: string
}

export function UsageProvider({
    children,
    baseURL,
    referenceId: initialRefId,
    referenceType: initialRefType = "user",
}: UsageProviderProps) {
    const featuresRef = useRef<Set<string>>(new Set())
    const handleRef = useRef<UsageTrackerHandle | null>(null)

    const [ctx, setCtx] = useState<UsageContextValue>(() => ({
        handle: null,
        referenceId: initialRefId,
        referenceType: initialRefType,
        setReference: () => {},
        registerFeature: () => {},
    }))

    const createHandle = useCallback((refId: string, refType: string) => {
        if (handleRef.current) {
            handleRef.current.dispose()
        }

        const features = Array.from(featuresRef.current)
        if (features.length === 0) {
            handleRef.current = null
            setCtx(prev => ({ ...prev, handle: null, referenceId: refId, referenceType: refType }))
            return
        }

        const tracker = createUsageTracker({
            baseURL,
            websocket: true,
        })

        handleRef.current = tracker.track({
            referenceId: refId,
            features,
            referenceType: refType,
        })

        setCtx(prev => ({
            ...prev,
            handle: handleRef.current,
            referenceId: refId,
            referenceType: refType,
        }))
    }, [baseURL])

    const setReference = useCallback((referenceId: string, referenceType?: string) => {
        const refType = referenceType ?? ctx.referenceType
        createHandle(referenceId, refType)
    }, [createHandle, ctx.referenceType])

    const registerFeature = useCallback((feature: string) => {
        if (featuresRef.current.has(feature)) return
        featuresRef.current.add(feature)
        createHandle(ctx.referenceId, ctx.referenceType)
    }, [createHandle, ctx.referenceId, ctx.referenceType])

    useEffect(() => {
        setCtx(prev => ({ ...prev, setReference, registerFeature }))
    }, [setReference, registerFeature])

    useEffect(() => {
        return () => {
            handleRef.current?.dispose()
            handleRef.current = null
        }
    }, [])

    return (
        <UsageContext.Provider value={ctx}>
            {children}
        </UsageContext.Provider>
    )
}

// ── useFeature ──

export interface UseFeatureResult {
    /** Current usage state. Null until first fetch completes. */
    usage: UsageState | null
    /** Atomic check + consume. Only consumes if in-limit. */
    consume: (amount?: number, event?: string) => Promise<ConsumeResult>
    /** Event log for this feature. */
    log: LogEntry[]
}

/**
 * Track and consume a feature.
 *
 * ```tsx
 * const { usage, consume, log } = useFeature("api-calls")
 *
 * usage?.status  // "in-limit" | "above-max-limit" | "below-min-limit"
 * usage?.current // 74
 * usage?.max     // 100
 *
 * await consume(1)
 * ```
 */
export function useFeature(feature: string): UseFeatureResult {
    const ctx = useContext(UsageContext)
    if (!ctx) throw new Error("useFeature must be used within <UsageProvider>")

    const { handle, registerFeature } = ctx

    useEffect(() => {
        registerFeature(feature)
    }, [feature, registerFeature])

    const emptySnapshot = { state: {} as Record<string, UsageState>, logs: {} as Record<string, LogEntry[]> }
    const snapshot = useSyncExternalStore(
        useCallback((cb) => handle?.subscribe(cb) ?? (() => {}), [handle]),
        useCallback(() => handle?.getSnapshot() ?? emptySnapshot, [handle]),
        () => emptySnapshot,
    )

    const usage = snapshot.state[feature] ?? null
    const log = snapshot.logs[feature] ?? []

    const consume = useCallback(
        (amount = 1, event?: string) => {
            if (!handle) return Promise.reject(new Error("Not connected"))
            return handle.consume(feature, amount, event)
        },
        [handle, feature],
    )

    return { usage, consume, log }
}

// ── useSetReference ──

/**
 * Change the tracked referenceId.
 *
 * ```tsx
 * const setReference = useSetReference()
 * setReference("org-456", "org")
 * ```
 */
export function useSetReference(): (referenceId: string, referenceType?: string) => void {
    const ctx = useContext(UsageContext)
    if (!ctx) throw new Error("useSetReference must be used within <UsageProvider>")
    return ctx.setReference
}

// ── useAllLogs ──

/**
 * Get the combined event log across all features, sorted by time.
 */
export function useAllLogs(): LogEntry[] {
    const ctx = useContext(UsageContext)
    if (!ctx) throw new Error("useAllLogs must be used within <UsageProvider>")

    const { handle } = ctx
    const emptySnapshot = { state: {} as Record<string, UsageState>, logs: {} as Record<string, LogEntry[]> }
    const snapshot = useSyncExternalStore(
        useCallback((cb) => handle?.subscribe(cb) ?? (() => {}), [handle]),
        useCallback(() => handle?.getSnapshot() ?? emptySnapshot, [handle]),
        () => emptySnapshot,
    )

    return Object.values(snapshot.logs).flat().sort((a, b) => a.ts - b.ts)
}

// ── Re-exports ──

export type {
    UsageState,
    ConsumeResult,
    LogEntry,
} from "../client"
