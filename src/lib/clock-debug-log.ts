// Fire-and-forget client-side logger for clock-in/out debug diagnostics.
// Never throws or blocks the clock-in/out flow.
// Automatically collects rich environment info for debugging.

export type ClockAction = 'clock_in' | 'clock_out' | 'device_registration'
export type ClockStep =
    | 'auth_check'
    | 'device_detection'
    | 'device_registered'
    | 'device_match'
    | 'already_clocked_in'
    | 'gps_capture'
    | 'break_return'
    | 'lunch_close'
    | 'db_insert'
    | 'db_update'
    | 'schedule_lookup'
    | 'late_checkout'
    | 'hours_calc'
    | 'complete'
    | 'device_register_start'
    | 'device_register'
    | 'device_reset_start'
    | 'device_reset_auth'
    | 'device_reset'
    | 'error'
export type ClockStatus = 'pass' | 'fail' | 'info' | 'success'

interface EnvironmentInfo {
    browser: string
    browserVersion: string
    os: string
    platform: string           // 'mobile' | 'tablet' | 'desktop'
    screenWidth: number
    screenHeight: number
    viewportWidth: number
    viewportHeight: number
    devicePixelRatio: number
    orientation: string        // 'portrait' | 'landscape'
    online: boolean
    cookiesEnabled: boolean
    touchSupport: boolean
    language: string
    languages: string[]
    timezone: string
    timezoneOffset: number
    connectionType: string | null
    connectionEffective: string | null
    connectionDownlink: number | null
    serviceWorker: boolean
    localStorage: boolean
    webGL: boolean
}

// Cache env info — it doesn't change during a session
let cachedEnvInfo: EnvironmentInfo | null = null

function parseBrowser(ua: string): { name: string; version: string } {
    // Order matters — check more specific patterns first
    let match: RegExpMatchArray | null

    // Samsung Internet
    match = ua.match(/SamsungBrowser\/(\d+[\d.]*)/)
    if (match) return { name: 'Samsung Internet', version: match[1] }

    // UCBrowser
    match = ua.match(/UCBrowser\/(\d+[\d.]*)/)
    if (match) return { name: 'UC Browser', version: match[1] }

    // Opera / OPR
    match = ua.match(/OPR\/(\d+[\d.]*)/)
    if (match) return { name: 'Opera', version: match[1] }

    // Edge (Chromium)
    match = ua.match(/Edg(?:e|A|iOS)?\/(\d+[\d.]*)/)
    if (match) return { name: 'Edge', version: match[1] }

    // Chrome on iOS
    match = ua.match(/CriOS\/(\d+[\d.]*)/)
    if (match) return { name: 'Chrome iOS', version: match[1] }

    // Firefox on iOS
    match = ua.match(/FxiOS\/(\d+[\d.]*)/)
    if (match) return { name: 'Firefox iOS', version: match[1] }

    // Firefox
    match = ua.match(/Firefox\/(\d+[\d.]*)/)
    if (match) return { name: 'Firefox', version: match[1] }

    // Chrome (must be after Edge/Opera/Samsung which include "Chrome" in UA)
    match = ua.match(/Chrome\/(\d+[\d.]*)/)
    if (match) return { name: 'Chrome', version: match[1] }

    // Safari (must be last — many browsers include "Safari" in UA)
    match = ua.match(/Version\/(\d+[\d.]*).*Safari/)
    if (match) return { name: 'Safari', version: match[1] }

    return { name: 'Unknown', version: 'Unknown' }
}

function parseOS(ua: string): string {
    if (/Windows NT 10/.test(ua)) return 'Windows 10/11'
    if (/Windows NT 6\.3/.test(ua)) return 'Windows 8.1'
    if (/Windows NT 6\.2/.test(ua)) return 'Windows 8'
    if (/Windows NT 6\.1/.test(ua)) return 'Windows 7'
    if (/Windows/.test(ua)) return 'Windows'

    const iosMatch = ua.match(/OS (\d+[_\d]*)/)
    if (/iPhone/.test(ua) && iosMatch) return `iOS ${iosMatch[1].replace(/_/g, '.')}`
    if (/iPad/.test(ua) && iosMatch) return `iPadOS ${iosMatch[1].replace(/_/g, '.')}`
    if (/iPhone/.test(ua)) return 'iOS'
    if (/iPad/.test(ua)) return 'iPadOS'

    const androidMatch = ua.match(/Android (\d+[\d.]*)/)
    if (androidMatch) return `Android ${androidMatch[1]}`
    if (/Android/.test(ua)) return 'Android'

    if (/Mac OS X (\d+[_\d]*)/.test(ua)) {
        const v = ua.match(/Mac OS X (\d+[_\d]*)/)
        return `macOS ${v?.[1]?.replace(/_/g, '.') || ''}`
    }
    if (/Macintosh/.test(ua)) return 'macOS'
    if (/CrOS/.test(ua)) return 'ChromeOS'
    if (/Linux/.test(ua)) return 'Linux'

    return 'Unknown OS'
}

function detectPlatform(ua: string): string {
    if (/iPad/.test(ua)) return 'tablet'
    if (/Android/.test(ua) && !/Mobile/.test(ua)) return 'tablet'
    if (/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone/i.test(ua)) return 'mobile'
    return 'desktop'
}

function detectWebGL(): boolean {
    try {
        const canvas = document.createElement('canvas')
        return !!(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
    } catch {
        return false
    }
}

// Navigator with connection API
interface NavigatorWithConnection extends Navigator {
    connection?: {
        type?: string
        effectiveType?: string
        downlink?: number
    }
}

function collectEnvironmentInfo(): EnvironmentInfo {
    if (cachedEnvInfo) return cachedEnvInfo

    const ua = navigator.userAgent
    const { name: browser, version: browserVersion } = parseBrowser(ua)
    const os = parseOS(ua)
    const platform = detectPlatform(ua)
    const conn = (navigator as NavigatorWithConnection).connection

    cachedEnvInfo = {
        browser,
        browserVersion,
        os,
        platform,
        screenWidth: screen.width,
        screenHeight: screen.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1,
        orientation: window.innerWidth > window.innerHeight ? 'landscape' : 'portrait',
        online: navigator.onLine,
        cookiesEnabled: navigator.cookieEnabled,
        touchSupport: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
        language: navigator.language,
        languages: Array.from(navigator.languages || [navigator.language]),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        timezoneOffset: new Date().getTimezoneOffset(),
        connectionType: conn?.type ?? null,
        connectionEffective: conn?.effectiveType ?? null,
        connectionDownlink: conn?.downlink ?? null,
        serviceWorker: 'serviceWorker' in navigator,
        localStorage: (() => { try { return !!window.localStorage } catch { return false } })(),
        webGL: detectWebGL(),
    }

    return cachedEnvInfo
}

interface ClockDebugEntry {
    action: ClockAction
    step: ClockStep
    status: ClockStatus
    message: string
    details?: Record<string, unknown>
    device_id?: string | null
    device_name?: string | null
}

export function logClockDebug(
    action: ClockAction,
    step: ClockStep,
    status: ClockStatus,
    message: string,
    details?: Record<string, unknown>,
    deviceInfo?: { deviceId?: string; deviceName?: string } | null,
): void {
    try {
        const entry: ClockDebugEntry = {
            action,
            step,
            status,
            message,
            details,
            device_id: deviceInfo?.deviceId ?? null,
            device_name: deviceInfo?.deviceName ?? null,
        }

        const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : null

        // Collect rich environment info for debugging
        let envInfo: EnvironmentInfo | null = null
        if (typeof window !== 'undefined') {
            try {
                envInfo = collectEnvironmentInfo()
            } catch {
                // If env collection fails, proceed without it
            }
        }

        fetch('/api/clock-debug-log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...entry, user_agent: userAgent, env_info: envInfo }),
        }).catch(() => {
            // Silently ignore — never interfere with clock-in/out
        })
    } catch {
        // Silently ignore
    }
}
