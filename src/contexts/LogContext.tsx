'use client'

import { createContext, useContext, useMemo, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import LogOverlay from '@/components/LogOverlay'
import { logger, useLogStream } from '@/lib/logger'

interface LoggerActions {
    log(message: string): void
    warn(message: string): void
    error(message: string): void
}

const LogContext = createContext<LoggerActions | null>(null)

export function LogProvider({ children }: { children: React.ReactNode }) {
    const logs = useLogStream()
    const pathname = usePathname()

    useEffect(() => {
        if (pathname) {
            logger.log(`navigated to ${pathname}`)
        }
    }, [pathname])

    const value = useMemo(
        () => ({
            log: (message: string) => logger.log(message),
            warn: (message: string) => logger.warn(message),
            error: (message: string) => logger.error(message),
        }), []
    )

    return (
        <LogContext.Provider value={value}>
            {children}
            <LogOverlay logs={logs} />
        </LogContext.Provider>
    )
}

export function useLogger() {
    const ctx = useContext(LogContext)
    if (!ctx) {
        throw new Error('useLogger must be used inside LogProvider')
    }
    return ctx
}
