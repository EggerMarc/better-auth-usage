import { Layer } from "effect"
import { WebSocketServer, WebSocket } from "ws"
import type { IncomingMessage } from "http"
import type { AuthContext } from "better-auth"
import type { ResolvedUsageOptions } from "@/types"
import { DriverService, DbService, LoggerService, defaultLogger } from "@/services"
import { handleClientMessage, type WsConnection, type HandlerContext } from "./handler"
import { parseClientMsg, encode, roomFor, type ServerMsg } from "./protocol"

type WsLayer = Layer.Layer<DriverService | DbService | LoggerService>

export interface WsServerHandle {
    close(): Promise<void>
}

/**
 * Node WebSocket server — the realtime transport for the Redis/in-memory
 * drivers (the Durable Object driver is its own transport). Holds raw
 * connections, a room registry, and bridges driver usage events to rooms.
 * Speaks the native protocol in `protocol.ts`; no socket.io.
 */
export function startWsServer(opts: {
    port: number
    options: ResolvedUsageOptions
    layer: WsLayer
    authCtx: AuthContext
    logger?: Partial<LoggerService>
}): WsServerHandle {
    const logger: LoggerService = { ...defaultLogger, ...opts.logger }
    const driver = opts.options.driver

    // room → set of connections subscribed to it
    const rooms = new Map<string, Set<NodeConn>>()

    class NodeConn implements WsConnection {
        auth: WsConnection["auth"] = null
        private joined = new Set<string>()
        constructor(private ws: WebSocket) {}

        send(msg: ServerMsg): void {
            if (this.ws.readyState === WebSocket.OPEN) this.ws.send(encode(msg))
        }
        join(room: string): void {
            this.joined.add(room)
            let set = rooms.get(room)
            if (!set) rooms.set(room, (set = new Set()))
            set.add(this)
        }
        leave(room: string): void {
            this.joined.delete(room)
            const set = rooms.get(room)
            if (set) {
                set.delete(this)
                if (set.size === 0) rooms.delete(room)
            }
        }
        leaveAll(): void {
            for (const room of this.joined) this.leave(room)
        }
    }

    const ctx: HandlerContext = { options: opts.options, layer: opts.layer, authCtx: opts.authCtx }

    const wss = new WebSocketServer({ port: opts.port })

    wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
        const conn = new NodeConn(ws)

        // Convenience: accept the token as a query param (browsers can't set WS
        // headers). Equivalent to the client sending { t: "auth", token } first.
        const token = tokenFromUrl(req.url)
        if (token) void handleClientMessage(conn, { t: "auth", token }, ctx)

        ws.on("message", (raw) => {
            const msg = parseClientMsg(raw.toString())
            if (!msg) {
                conn.send({ t: "error", message: "Malformed message" })
                return
            }
            void handleClientMessage(conn, msg, ctx)
        })

        ws.on("close", () => conn.leaveAll())
        ws.on("error", () => conn.leaveAll())
    })

    // Bridge driver usage events → room broadcast.
    let unsubscribe: (() => void) | undefined
    Promise.resolve(
        driver.realtime?.onUsageEvent((evt) => {
            const room = roomFor(evt.feature, evt.refId)
            const set = rooms.get(room)
            if (!set) return
            const frame: ServerMsg = { t: "event", room, data: evt }
            for (const c of set) c.send(frame)
        })
    ).then((unsub) => { unsubscribe = unsub })

    logger.info("WebSocket server listening", { port: opts.port })

    return {
        close: () =>
            new Promise<void>((resolve) => {
                unsubscribe?.()
                for (const ws of wss.clients) ws.terminate()
                wss.close(() => resolve())
            }),
    }
}

/** Extract `?token=...` from a request URL. */
function tokenFromUrl(url: string | undefined): string | null {
    if (!url) return null
    const q = url.indexOf("?")
    if (q === -1) return null
    return new URLSearchParams(url.slice(q + 1)).get("token")
}
