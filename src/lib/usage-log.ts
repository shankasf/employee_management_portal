'use client'

// Usage logging types
export type EventType = 'page_view' | 'button_click' | 'form_submit' | 'feature_use' | 'navigation' | 'error'

export type EventCategory =
    | 'auth'
    | 'attendance'
    | 'schedule'
    | 'task'
    | 'event'
    | 'employee'
    | 'report'
    | 'policy'
    | 'settings'
    | 'navigation'
    | 'general'

export interface UsageLogEntry {
    eventType: EventType
    eventCategory: EventCategory
    eventAction: string
    eventLabel?: string
    pagePath?: string
    pageTitle?: string
    metadata?: Record<string, unknown>
}

// Generate a session ID that persists for the browser session
function getSessionId(): string {
    if (typeof window === 'undefined') return 'server'

    let sessionId = sessionStorage.getItem('usage_session_id')
    if (!sessionId) {
        sessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
        sessionStorage.setItem('usage_session_id', sessionId)
    }
    return sessionId
}

// Queue for batching logs
let logQueue: UsageLogEntry[] = []
let flushTimeout: NodeJS.Timeout | null = null
const FLUSH_INTERVAL = 5000 // 5 seconds
const MAX_QUEUE_SIZE = 10

/**
 * Log a usage event (batched for performance)
 */
export function logUsage(entry: UsageLogEntry): void {
    if (typeof window === 'undefined') return

    // Add current page info if not provided
    const enrichedEntry: UsageLogEntry = {
        ...entry,
        pagePath: entry.pagePath || window.location.pathname,
        pageTitle: entry.pageTitle || document.title,
    }

    logQueue.push(enrichedEntry)

    // Flush immediately if queue is full
    if (logQueue.length >= MAX_QUEUE_SIZE) {
        flushLogs()
    } else if (!flushTimeout) {
        // Schedule a flush
        flushTimeout = setTimeout(flushLogs, FLUSH_INTERVAL)
    }
}

/**
 * Flush all queued logs to the server
 */
async function flushLogs(): Promise<void> {
    if (flushTimeout) {
        clearTimeout(flushTimeout)
        flushTimeout = null
    }

    if (logQueue.length === 0) return

    const logsToSend = [...logQueue]
    logQueue = []

    try {
        const sessionId = getSessionId()

        await fetch('/api/usage-log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                logs: logsToSend,
                sessionId,
            }),
            keepalive: true, // Ensure logs are sent even on page unload
        })
    } catch (error) {
        // Silently fail - don't disrupt user experience
        console.debug('[UsageLog] Failed to send logs:', error)
    }
}

// Flush logs when page is about to unload
if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
        if (logQueue.length > 0) {
            // Use sendBeacon for reliable delivery on page unload
            const sessionId = getSessionId()
            navigator.sendBeacon('/api/usage-log', new Blob([JSON.stringify({
                logs: logQueue,
                sessionId,
            })], { type: 'application/json' }))
        }
    })

    // Also flush on visibility change (tab switching)
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            flushLogs()
        }
    })
}

// Convenience functions for common events

export function logPageView(pageName: string, category: EventCategory = 'navigation'): void {
    logUsage({
        eventType: 'page_view',
        eventCategory: category,
        eventAction: 'view',
        eventLabel: pageName,
    })
}

export function logButtonClick(buttonName: string, category: EventCategory, metadata?: Record<string, unknown>): void {
    logUsage({
        eventType: 'button_click',
        eventCategory: category,
        eventAction: 'click',
        eventLabel: buttonName,
        metadata,
    })
}

export function logFormSubmit(formName: string, category: EventCategory, success: boolean, metadata?: Record<string, unknown>): void {
    logUsage({
        eventType: 'form_submit',
        eventCategory: category,
        eventAction: success ? 'submit_success' : 'submit_error',
        eventLabel: formName,
        metadata,
    })
}

export function logFeatureUse(featureName: string, category: EventCategory, action: string, metadata?: Record<string, unknown>): void {
    logUsage({
        eventType: 'feature_use',
        eventCategory: category,
        eventAction: action,
        eventLabel: featureName,
        metadata,
    })
}

export function logError(errorName: string, category: EventCategory, errorMessage: string): void {
    logUsage({
        eventType: 'error',
        eventCategory: category,
        eventAction: 'error',
        eventLabel: errorName,
        metadata: { error: errorMessage },
    })
}
