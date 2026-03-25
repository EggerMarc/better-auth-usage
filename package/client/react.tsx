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
    type CheckResult,
    type ConsumeResult,
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
        // Recreate handle with new feature list
        createHandle(ctx.referenceId, ctx.referenceType)
    }, [createHandle, ctx.referenceId, ctx.referenceType])

    // Update setReference/registerFeature in context when they change
    useEffect(() => {
        setCtx(prev => ({ ...prev, setReference, registerFeature }))
    }, [setReference, registerFeature])

    // Cleanup on unmount
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

// ── useUsage ──

export interface UseUsageResult {
    /** Current usage state. Null until first fetch completes. */
    usage: UsageState | null
    /** Whether the feature is within its limits. */
    isAllowed: boolean
    /** Consume usage. */
    consume: (amount: number, event?: string) => Promise<ConsumeResult>
    /** Check usage without consuming. */
    check: (amount?: number) => Promise<CheckResult>
    /** Entitlement check. */
    canUse: (amount?: number) => Promise<CheckResult>
    /** Atomic check + consume. */
    useFeature: (amount?: number, event?: string) => Promise<ConsumeResult>
}

/**
 * Access usage state and operations for a feature.
 *
 * ```tsx
 * const { usage, isAllowed, consume, check } = useUsage("api-calls")
 * ```
 */
export function useUsage(feature: string): UseUsageResult {
    const ctx = useContext(UsageContext)
    if (!ctx) throw new Error("useUsage must be used within <UsageProvider>")

    const { handle, registerFeature } = ctx

    // Register this feature on mount
    useEffect(() => {
        registerFeature(feature)
    }, [feature, registerFeature])

    const state = useSyncExternalStore(
        useCallback((cb) => handle?.subscribe(cb) ?? (() => {}), [handle]),
        useCallback(() => handle?.getSnapshot() ?? {}, [handle]),
        () => ({} as Record<string, UsageState>),
    )

    const usage = state[feature] ?? null
    const isAllowed = usage?.allowed ?? true

    const consume = useCallback(
        (amount: number, event?: string) => {
            if (!handle) return Promise.reject(new Error("Not connected"))
            return handle.consume(feature, amount, event)
        },
        [handle, feature],
    )

    const check = useCallback(
        (amount?: number) => {
            if (!handle) return Promise.reject(new Error("Not connected"))
            return handle.check(feature, amount)
        },
        [handle, feature],
    )

    const canUse = useCallback(
        (amount?: number) => {
            if (!handle) return Promise.reject(new Error("Not connected"))
            return handle.canUse(feature, amount)
        },
        [handle, feature],
    )

    const useFeatureFn = useCallback(
        (amount?: number, event?: string) => {
            if (!handle) return Promise.reject(new Error("Not connected"))
            return handle.useFeature(feature, amount, event)
        },
        [handle, feature],
    )

    return { usage, isAllowed, consume, check, canUse, useFeature: useFeatureFn }
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

// ── Re-exports ──

export type {
    UsageState,
    CheckResult,
    ConsumeResult,
} from "../client"
