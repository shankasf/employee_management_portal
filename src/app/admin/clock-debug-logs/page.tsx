'use client'

import { useState } from 'react'
import useSWR from 'swr'

interface ClockDebugLog {
    id: string
    employee_id: string
    employee_email: string
    action: string
    step: string
    status: string
    message: string
    details: Record<string, unknown> | null
    device_id: string | null
    device_name: string | null
    user_agent: string | null
    ip_address: string | null
    created_at: string
}

const STATUS_COLORS: Record<string, string> = {
    pass: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    success: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    fail: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    info: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
}

const STATUS_ICONS: Record<string, string> = {
    pass: '✅',
    success: '✅',
    fail: '❌',
    info: 'ℹ️',
}

const STEP_LABELS: Record<string, string> = {
    auth_check: 'Auth Check',
    device_detection: 'Device Detection',
    device_registered: 'Device Registered',
    device_match: 'Device Match',
    already_clocked_in: 'Already Clocked In',
    gps_capture: 'GPS Capture',
    db_insert: 'DB Insert',
    db_update: 'DB Update',
    schedule_lookup: 'Schedule Lookup',
    late_checkout: 'Late Checkout',
    hours_calc: 'Hours Calculation',
    complete: 'Complete',
    device_register_start: 'Device Register Start',
    device_register: 'Device Register',
    error: 'Error',
}

function formatDate(dateString: string): string {
    const date = new Date(dateString)
    return date.toLocaleString('en-US', {
        timeZone: 'America/New_York',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
    })
}

interface EnvInfo {
    browser?: string
    browserVersion?: string
    os?: string
    platform?: string
    screenWidth?: number
    screenHeight?: number
    viewportWidth?: number
    viewportHeight?: number
    devicePixelRatio?: number
    orientation?: string
    online?: boolean
    cookiesEnabled?: boolean
    touchSupport?: boolean
    language?: string
    languages?: string[]
    timezone?: string
    timezoneOffset?: number
    connectionType?: string | null
    connectionEffective?: string | null
    connectionDownlink?: number | null
    serviceWorker?: boolean
    localStorage?: boolean
    webGL?: boolean
}

function getEnvFromLog(log: ClockDebugLog): EnvInfo | null {
    const env = log.details?.env as EnvInfo | undefined
    return env || null
}

function formatBrowserShort(log: ClockDebugLog): string {
    const env = getEnvFromLog(log)
    if (env?.browser) {
        return `${env.browser} ${env.browserVersion || ''}`.trim()
    }
    // Fallback to UA parsing
    const ua = log.user_agent
    if (!ua) return 'Unknown'
    if (ua.includes('SamsungBrowser')) return 'Samsung Internet'
    if (ua.includes('CriOS')) return 'Chrome (iOS)'
    if (ua.includes('FxiOS')) return 'Firefox (iOS)'
    if (ua.includes('Edg')) return 'Edge'
    if (ua.includes('Chrome') && ua.includes('Mobile')) return 'Chrome Mobile'
    if (ua.includes('Chrome')) return 'Chrome'
    if (ua.includes('Firefox')) return 'Firefox'
    if (ua.includes('Safari') && ua.includes('Mobile')) return 'Safari Mobile'
    if (ua.includes('Safari')) return 'Safari'
    if (ua.includes('Mobile')) return 'Mobile Browser'
    return 'Browser'
}

function formatPlatformIcon(env: EnvInfo | null): string {
    if (!env?.platform) return ''
    if (env.platform === 'mobile') return '📱'
    if (env.platform === 'tablet') return '📱'
    return '💻'
}

function getStatusColor(status: string): string {
    return STATUS_COLORS[status] || 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
}

export default function ClockDebugLogsPage() {
    const [employeeFilter, setEmployeeFilter] = useState('all')
    const [actionFilter, setActionFilter] = useState('all')
    const [statusFilter, setStatusFilter] = useState('all')
    const [expandedLog, setExpandedLog] = useState<string | null>(null)

    const { data: logs = [], isLoading, mutate } = useSWR<ClockDebugLog[]>(
        ['admin:clock-debug-logs', employeeFilter, actionFilter, statusFilter],
        async () => {
            const params = new URLSearchParams()
            if (employeeFilter !== 'all') params.set('employee', employeeFilter)
            if (actionFilter !== 'all') params.set('action', actionFilter)
            if (statusFilter !== 'all') params.set('status', statusFilter)
            params.set('limit', '200')

            const res = await fetch(`/api/clock-debug-log?${params.toString()}`)
            if (!res.ok) throw new Error('Failed to fetch logs')
            return res.json()
        },
        { revalidateOnFocus: false, refreshInterval: 30000 }
    )

    // Extract unique employees for filter dropdown
    const uniqueEmployees = Array.from(
        new Map(logs.map(l => [l.employee_id, l.employee_email])).entries()
    )

    // Group logs by session (same employee + action within 60s window)
    const groupedLogs = logs.reduce<{ sessionKey: string; logs: ClockDebugLog[] }[]>((groups, log) => {
        const lastGroup = groups[groups.length - 1]
        if (
            lastGroup &&
            lastGroup.logs[0].employee_id === log.employee_id &&
            lastGroup.logs[0].action === log.action &&
            Math.abs(new Date(lastGroup.logs[lastGroup.logs.length - 1].created_at).getTime() - new Date(log.created_at).getTime()) < 60000
        ) {
            lastGroup.logs.push(log)
        } else {
            groups.push({
                sessionKey: `${log.employee_id}-${log.action}-${log.created_at}`,
                logs: [log],
            })
        }
        return groups
    }, [])

    return (
        <div className="space-y-4 sm:space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold">Clock Debug Logs</h1>
                    <p className="text-muted-foreground mt-1 text-sm sm:text-base">
                        Diagnose clock-in/out issues with step-by-step logs
                    </p>
                </div>
                <button
                    onClick={() => mutate()}
                    className="btn-secondary text-sm flex items-center gap-2"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Refresh
                </button>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-3">
                <select
                    className="input w-full sm:w-48"
                    value={actionFilter}
                    onChange={(e) => setActionFilter(e.target.value)}
                >
                    <option value="all">All Actions</option>
                    <option value="clock_in">Clock In</option>
                    <option value="clock_out">Clock Out</option>
                    <option value="device_registration">Device Registration</option>
                </select>

                <select
                    className="input w-full sm:w-48"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                >
                    <option value="all">All Statuses</option>
                    <option value="fail">Failed Only</option>
                    <option value="pass">Passed Only</option>
                    <option value="info">Info Only</option>
                    <option value="success">Success Only</option>
                </select>

                {uniqueEmployees.length > 1 && (
                    <select
                        className="input w-full sm:w-56"
                        value={employeeFilter}
                        onChange={(e) => setEmployeeFilter(e.target.value)}
                    >
                        <option value="all">All Employees</option>
                        {uniqueEmployees.map(([id, email]) => (
                            <option key={id} value={id}>{email}</option>
                        ))}
                    </select>
                )}
            </div>

            {isLoading ? (
                <div className="space-y-3">
                    {[...Array(5)].map((_, i) => (
                        <div key={i} className="h-20 bg-muted rounded-lg animate-pulse"></div>
                    ))}
                </div>
            ) : logs.length === 0 ? (
                <div className="card p-8 text-center">
                    <div className="text-4xl mb-4">🕐</div>
                    <p className="text-muted-foreground">No clock debug logs found</p>
                    <p className="text-sm text-muted-foreground mt-1">
                        Logs will appear here when employees attempt to clock in or out
                    </p>
                </div>
            ) : (
                <div className="space-y-4">
                    {groupedLogs.map((group) => {
                        const firstLog = group.logs[0]
                        const hasFail = group.logs.some(l => l.status === 'fail')
                        const isComplete = group.logs.some(l => l.step === 'complete')
                        const isExpanded = expandedLog === group.sessionKey

                        return (
                            <div
                                key={group.sessionKey}
                                className={`card overflow-hidden ${hasFail ? 'border-red-300 dark:border-red-800' : isComplete ? 'border-green-300 dark:border-green-800' : ''}`}
                            >
                                {/* Session header */}
                                <div
                                    className="p-4 cursor-pointer hover:bg-muted/30 transition-colors"
                                    onClick={() => setExpandedLog(isExpanded ? null : group.sessionKey)}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                                            hasFail ? 'bg-red-100 dark:bg-red-900/30' :
                                            isComplete ? 'bg-green-100 dark:bg-green-900/30' :
                                            'bg-blue-100 dark:bg-blue-900/30'
                                        }`}>
                                            <span className="text-lg">
                                                {hasFail ? '❌' : isComplete ? '✅' : '⏳'}
                                            </span>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                                                    firstLog.action === 'clock_in'
                                                        ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                                                        : firstLog.action === 'device_registration'
                                                        ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400'
                                                        : 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400'
                                                }`}>
                                                    {firstLog.action === 'clock_in' ? 'Clock In' : firstLog.action === 'device_registration' ? 'Device Registration' : 'Clock Out'}
                                                </span>
                                                <span className="font-medium text-sm truncate">
                                                    {firstLog.employee_email}
                                                </span>
                                                <span className="text-xs text-muted-foreground">
                                                    ({group.logs.length} steps)
                                                </span>
                                            </div>
                                            <div className="mt-1 text-xs text-muted-foreground flex flex-wrap gap-2">
                                                <span>{formatDate(firstLog.created_at)}</span>
                                                {firstLog.device_name && (
                                                    <span className="hidden sm:inline">
                                                        • {firstLog.device_name}
                                                    </span>
                                                )}
                                                <span className="hidden sm:inline">
                                                    • {formatPlatformIcon(getEnvFromLog(firstLog))} {formatBrowserShort(firstLog)}
                                                </span>
                                                {getEnvFromLog(firstLog)?.os && (
                                                    <span className="hidden sm:inline">
                                                        • {getEnvFromLog(firstLog)!.os}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 flex-shrink-0">
                                            {/* Summary badges */}
                                            {hasFail && (
                                                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                                                    FAILED
                                                </span>
                                            )}
                                            <svg
                                                xmlns="http://www.w3.org/2000/svg"
                                                className={`h-5 w-5 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                                                fill="none"
                                                viewBox="0 0 24 24"
                                                stroke="currentColor"
                                            >
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                            </svg>
                                        </div>
                                    </div>
                                </div>

                                {/* Expanded: step-by-step timeline */}
                                {isExpanded && (
                                    <div className="border-t px-4 pb-4">
                                        <div className="mt-3 space-y-0">
                                            {group.logs.map((log, idx) => (
                                                <div key={log.id} className="flex gap-3">
                                                    {/* Timeline connector */}
                                                    <div className="flex flex-col items-center">
                                                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs flex-shrink-0 ${getStatusColor(log.status)}`}>
                                                            {STATUS_ICONS[log.status] || '•'}
                                                        </div>
                                                        {idx < group.logs.length - 1 && (
                                                            <div className="w-0.5 flex-1 bg-border min-h-[16px]"></div>
                                                        )}
                                                    </div>

                                                    {/* Step content */}
                                                    <div className="pb-3 flex-1 min-w-0">
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${getStatusColor(log.status)}`}>
                                                                {log.status.toUpperCase()}
                                                            </span>
                                                            <span className="text-sm font-medium">
                                                                {STEP_LABELS[log.step] || log.step}
                                                            </span>
                                                        </div>
                                                        <p className="text-sm text-muted-foreground mt-0.5">
                                                            {log.message}
                                                        </p>
                                                        {log.details && (() => {
                                                            // Filter out env info from step details (shown in session metadata)
                                                            const stepDetails = Object.fromEntries(Object.entries(log.details).filter(([k]) => k !== 'env'))
                                                            return Object.keys(stepDetails).length > 0 ? (
                                                                <div className="mt-1 bg-muted/50 rounded p-2">
                                                                    <pre className="text-xs whitespace-pre-wrap break-words">
                                                                        {JSON.stringify(stepDetails, null, 2)}
                                                                    </pre>
                                                                </div>
                                                            ) : null
                                                        })()}
                                                        <span className="text-[10px] text-muted-foreground">
                                                            {new Date(log.created_at).toLocaleTimeString('en-US', {
                                                                timeZone: 'America/New_York',
                                                                hour: 'numeric',
                                                                minute: '2-digit',
                                                                second: '2-digit',
                                                                fractionalSecondDigits: 3,
                                                                hour12: true,
                                                            })}
                                                        </span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>

                                        {/* Session metadata */}
                                        {(() => {
                                            const env = getEnvFromLog(firstLog)
                                            return (
                                                <div className="mt-3 pt-3 border-t text-xs text-muted-foreground">
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                                                        {/* Identity */}
                                                        <div><strong>Employee ID:</strong> {firstLog.employee_id}</div>
                                                        {firstLog.ip_address && <div><strong>IP Address:</strong> {firstLog.ip_address}</div>}

                                                        {/* Device */}
                                                        {firstLog.device_id && <div><strong>Device ID:</strong> {firstLog.device_id}</div>}
                                                        {firstLog.device_name && <div><strong>Device Name:</strong> {firstLog.device_name}</div>}

                                                        {/* Browser & OS (from env_info) */}
                                                        {env?.browser && (
                                                            <div><strong>Browser:</strong> {env.browser} {env.browserVersion}</div>
                                                        )}
                                                        {env?.os && <div><strong>OS:</strong> {env.os}</div>}
                                                        {env?.platform && (
                                                            <div><strong>Platform:</strong> {env.platform === 'mobile' ? '📱 Mobile' : env.platform === 'tablet' ? '📱 Tablet' : '💻 Desktop'}</div>
                                                        )}

                                                        {/* Screen */}
                                                        {env?.screenWidth && (
                                                            <div><strong>Screen:</strong> {env.screenWidth}x{env.screenHeight} @ {env.devicePixelRatio}x DPR</div>
                                                        )}
                                                        {env?.viewportWidth && (
                                                            <div><strong>Viewport:</strong> {env.viewportWidth}x{env.viewportHeight} ({env.orientation})</div>
                                                        )}

                                                        {/* Network */}
                                                        {env?.connectionEffective && (
                                                            <div><strong>Connection:</strong> {env.connectionEffective}{env.connectionDownlink ? ` (${env.connectionDownlink} Mbps)` : ''}</div>
                                                        )}
                                                        {env?.connectionType && (
                                                            <div><strong>Network Type:</strong> {env.connectionType}</div>
                                                        )}
                                                        <div><strong>Online:</strong> {env?.online !== undefined ? (env.online ? 'Yes' : 'No') : 'Unknown'}</div>

                                                        {/* Capabilities */}
                                                        {env?.language && <div><strong>Language:</strong> {env.language}</div>}
                                                        {env?.timezone && <div><strong>Timezone:</strong> {env.timezone} (UTC{env.timezoneOffset !== undefined ? (env.timezoneOffset <= 0 ? '+' : '-') + Math.abs(env.timezoneOffset / 60) : '?'})</div>}
                                                        {env?.touchSupport !== undefined && (
                                                            <div><strong>Touch:</strong> {env.touchSupport ? 'Yes' : 'No'}</div>
                                                        )}
                                                        {env?.cookiesEnabled !== undefined && (
                                                            <div><strong>Cookies:</strong> {env.cookiesEnabled ? 'Enabled' : 'Disabled'}</div>
                                                        )}
                                                        {env?.localStorage !== undefined && (
                                                            <div><strong>LocalStorage:</strong> {env.localStorage ? 'Available' : 'Unavailable'}</div>
                                                        )}
                                                        {env?.serviceWorker !== undefined && (
                                                            <div><strong>Service Worker:</strong> {env.serviceWorker ? 'Supported' : 'Not supported'}</div>
                                                        )}
                                                    </div>

                                                    {/* Full UA string — collapsible */}
                                                    {firstLog.user_agent && (
                                                        <details className="mt-2">
                                                            <summary className="cursor-pointer text-xs font-medium">Full User Agent</summary>
                                                            <p className="mt-1 bg-muted/50 rounded p-2 break-all text-[11px] font-mono">{firstLog.user_agent}</p>
                                                        </details>
                                                    )}
                                                </div>
                                            )
                                        })()}
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
