/**
 * Server-side logging utility for PM2 logs
 * All logs are prefixed with timestamps and categories for easy filtering
 */

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'

interface LogOptions {
    userId?: string
    email?: string
    ip?: string
    path?: string
    method?: string
    duration?: number
    error?: unknown
    data?: Record<string, unknown>
}

function formatTimestamp(): string {
    return new Date().toISOString()
}

function formatLog(level: LogLevel, category: string, message: string, options?: LogOptions): string {
    const parts = [
        `[${formatTimestamp()}]`,
        `[${level}]`,
        `[${category}]`,
        message,
    ]

    if (options) {
        const details: string[] = []
        if (options.method && options.path) details.push(`${options.method} ${options.path}`)
        if (options.userId) details.push(`user:${options.userId.substring(0, 8)}`)
        if (options.email) details.push(`email:${options.email}`)
        if (options.ip) details.push(`ip:${options.ip}`)
        if (options.duration !== undefined) details.push(`${options.duration}ms`)
        if (details.length > 0) parts.push(`(${details.join(' | ')})`)
        if (options.data) parts.push(JSON.stringify(options.data))
        if (options.error) {
            const errorMsg = options.error instanceof Error ? options.error.message : String(options.error)
            parts.push(`ERROR: ${errorMsg}`)
        }
    }

    return parts.join(' ')
}

// Main logging functions
export const serverLog = {
    // API logging
    api: (message: string, options?: LogOptions) => {
        console.log(formatLog('INFO', 'API', message, options))
    },
    apiError: (message: string, options?: LogOptions) => {
        console.error(formatLog('ERROR', 'API', message, options))
    },

    // Auth logging
    auth: (message: string, options?: LogOptions) => {
        console.log(formatLog('INFO', 'AUTH', message, options))
    },
    authError: (message: string, options?: LogOptions) => {
        console.error(formatLog('ERROR', 'AUTH', message, options))
    },

    // Middleware logging
    middleware: (message: string, options?: LogOptions) => {
        console.log(formatLog('INFO', 'MIDDLEWARE', message, options))
    },

    // Database logging
    db: (message: string, options?: LogOptions) => {
        console.log(formatLog('INFO', 'DB', message, options))
    },
    dbError: (message: string, options?: LogOptions) => {
        console.error(formatLog('ERROR', 'DB', message, options))
    },

    // Email logging
    email: (message: string, options?: LogOptions) => {
        console.log(formatLog('INFO', 'EMAIL', message, options))
    },
    emailError: (message: string, options?: LogOptions) => {
        console.error(formatLog('ERROR', 'EMAIL', message, options))
    },

    // General logging
    info: (category: string, message: string, options?: LogOptions) => {
        console.log(formatLog('INFO', category, message, options))
    },
    warn: (category: string, message: string, options?: LogOptions) => {
        console.warn(formatLog('WARN', category, message, options))
    },
    error: (category: string, message: string, options?: LogOptions) => {
        console.error(formatLog('ERROR', category, message, options))
    },
    debug: (category: string, message: string, options?: LogOptions) => {
        if (process.env.NODE_ENV !== 'production' || process.env.DEBUG_LOGS === 'true') {
            console.log(formatLog('DEBUG', category, message, options))
        }
    },
}

// Helper to extract request info for logging
export function getRequestLogInfo(request: Request): LogOptions {
    const url = new URL(request.url)
    return {
        method: request.method,
        path: url.pathname,
        ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
            request.headers.get('x-real-ip') || undefined,
    }
}
