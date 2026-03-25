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
    type UsageEvent,
} from "../client"

// ── Context ──

interface UsageContextValue {
    handle: UsageTrackerHandle | null
    referenceId: string
    referenceType: string
    setReference: (referenceId: string, referenceType?: string) => void
    registerFeature: (feature: string) => void
}

// ── createUsageProvider ──

/**
 * Create a typed usage provider and hooks.
 *
 * Pass `typeof auth` to get feature key autocomplete everywhere.
 *
 * ```ts
 * // providers.tsx
 * import { createUsageProvider } from "@eggermarc/better-auth-usage/react"
 * import type { auth } from "@/lib/auth"
 *
 * export const { UsageProvider, useFeature, useSetReference } = createUsageProvider<typeof auth>()
 *
 * // component.tsx
 * import { useFeature } from "@/providers"
 * const { usage, consume } = useFeature("api-calls") // autocomplete works
 * ```
 */
export interface UsageProviderProps {
    children: ReactNode
    /** Base URL of the BetterAuth server. Default: "/api/auth" */
    baseURL?: string
    /** Reference ID to track usage for. */
    referenceId: string
    /** Reference type. Default: "user" */
    referenceType?: string
}

export interface UseFeatureResult {
    /** Current usage state. Null until first fetch completes. */
    usage: UsageState | null
    /** Atomic check + consume. Only consumes if in-limit. */
    consume: (amount?: number, event?: string) => Promise<ConsumeResult>
    /** Event log for this feature. */
    events: UsageEvent[]
}

export function createUsageProvider<Auth = any>() {
    type FeatureKey = Auth extends { options: { plugins: readonly (infer P)[] } }
        ? Extract<P, { id: "usage"; _featureKeys: any }> extends { _featureKeys: infer K }
            ? K & string
            : string
        : string

    const UsageContext = createContext<UsageContextValue | null>(null)

    function UsageProvider({
        children,
        baseURL = "/api/auth",
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

            const tracker = createUsageTracker({ baseURL, websocket: true })
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

    function useFeature(feature: FeatureKey): UseFeatureResult {
        const ctx = useContext(UsageContext)
        if (!ctx) throw new Error("useFeature must be used within <UsageProvider>")

        const { handle, registerFeature } = ctx

        useEffect(() => {
            registerFeature(feature)
        }, [feature, registerFeature])

        const emptySnapshot = { state: {} as Record<string, UsageState>, events: {} as Record<string, UsageEvent[]> }
        const snapshot = useSyncExternalStore(
            useCallback((cb) => handle?.subscribe(cb) ?? (() => {}), [handle]),
            useCallback(() => handle?.getSnapshot() ?? emptySnapshot, [handle]),
            () => emptySnapshot,
        )

        const usage = snapshot.state[feature] ?? null
        const events =snapshot.events[feature] ?? []

        const consume = useCallback(
            (amount = 1, event?: string) => {
                if (!handle) return Promise.reject(new Error("Not connected"))
                return handle.consume(feature, amount, event)
            },
            [handle, feature],
        )

        return { usage, consume, events }
    }

    // ── useSetReference ──

    function useSetReference() {
        const ctx = useContext(UsageContext)
        if (!ctx) throw new Error("useSetReference must be used within <UsageProvider>")
        return ctx.setReference
    }

    // ── useAllEvents ──

    function useAllEvents(): UsageEvent[] {
        const ctx = useContext(UsageContext)
        if (!ctx) throw new Error("useAllEvents must be used within <UsageProvider>")

        const { handle } = ctx
        const emptySnapshot = { state: {} as Record<string, UsageState>, events: {} as Record<string, UsageEvent[]> }
        const snapshot = useSyncExternalStore(
            useCallback((cb) => handle?.subscribe(cb) ?? (() => {}), [handle]),
            useCallback(() => handle?.getSnapshot() ?? emptySnapshot, [handle]),
            () => emptySnapshot,
        )

        return Object.values(snapshot.events).flat().sort((a, b) => a.ts - b.ts)
    }

    return { UsageProvider, useFeature, useSetReference, useAllEvents }
}

// ── Re-exports ──

export type {
    UsageState,
    ConsumeResult,
    UsageEvent,
} from "../client"
