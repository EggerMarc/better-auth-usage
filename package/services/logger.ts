import { Context, Layer } from "effect"

/**
 * LoggerService interface — structured logging.
 *
 * Users can provide their own logger (pino, winston, etc.)
 * via plugin options. Default uses console.
 */
export interface LoggerService {
    debug(message: string, context?: Record<string, unknown>): void
    info(message: string, context?: Record<string, unknown>): void
    warn(message: string, context?: Record<string, unknown>): void
    error(message: string, context?: Record<string, unknown>): void
}

export const LoggerService = Context.GenericTag<LoggerService>("LoggerService")

const PREFIX = "[better-auth-usage]"

/**
 * Default logger — writes to console with consistent prefix.
 */
export const defaultLogger: LoggerService = {
    debug: (msg, ctx) => console.debug(`${PREFIX} ${msg}`, ctx ?? ""),
    info: (msg, ctx) => console.info(`${PREFIX} ${msg}`, ctx ?? ""),
    warn: (msg, ctx) => console.warn(`${PREFIX} ${msg}`, ctx ?? ""),
    error: (msg, ctx) => console.error(`${PREFIX} ${msg}`, ctx ?? ""),
}

/**
 * Create a LoggerService Layer from a user-provided logger or the default.
 */
export const makeLoggerServiceLive = (logger?: Partial<LoggerService>): Layer.Layer<LoggerService> =>
    Layer.succeed(LoggerService, {
        ...defaultLogger,
        ...logger,
    })
