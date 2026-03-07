'use client'

import { useState } from 'react'
import { createUntypedClient } from '@/lib/supabase/client'
import { formatAction, ActivityAction } from '@/lib/activity-log'
import useSWR from 'swr'

interface ActivityLog {
    id: string
    admin_id: string
    admin_email: string
    action: ActivityAction
    entity_type: string
    entity_id: string | null
    entity_name: string | null
    details: Record<string, unknown> | null
    ip_address: string | null
    user_agent: string | null
    created_at: string
}

interface UsageLog {
    id: string
    user_id: string | null
    user_email: string | null
    user_role: string | null
    event_type: string
    event_category: string
    event_action: string
    event_label: string | null
    page_path: string | null
    page_title: string | null
    metadata: Record<string, unknown> | null
    session_id: string | null
    ip_address: string | null
    user_agent: string | null
    created_at: string
}

interface UploadLog {
    id: string
    user_id: string | null
    user_email: string | null
    user_role: string | null
    status: string
    bucket: string | null
    file_name: string | null
    file_size: number | null
    mime_type: string | null
    file_path: string | null
    upload_context: string | null
    entity_id: string | null
    error_message: string | null
    error_code: string | null
    user_agent: string | null
    device_name: string | null
    ip_address: string | null
    duration_ms: number | null
    created_at: string
}

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
    timezone?: string
    timezoneOffset?: number
    connectionType?: string | null
    connectionEffective?: string | null
    connectionDownlink?: number | null
    serviceWorker?: boolean
    localStorage?: boolean
}

const ACTION_COLORS: Record<string, string> = {
    employee_created: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    employee_deleted: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    employee_deactivated: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    employee_reactivated: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    employee_updated: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    device_cleared: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
    password_reset_requested: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
    password_reset_completed: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
    task_created: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    task_updated: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    task_deleted: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    task_assigned: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400',
    task_bulk_assigned: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400',
    task_bulk_deleted: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    task_instance_status_updated: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    task_instance_deleted: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    task_completed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    task_submission_updated: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    task_media_auto_deleted: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
    tasks_loaded: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
    tasks_load_failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    default: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
}

const EVENT_COLORS: Record<string, string> = {
    page_view: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    button_click: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    form_submit: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
    feature_use: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    navigation: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
    error: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    default: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
}

const EVENT_ICONS: Record<string, string> = {
    page_view: '👁️',
    button_click: '👆',
    form_submit: '📝',
    feature_use: '⚡',
    navigation: '🧭',
    error: '❌',
}

const UPLOAD_STATUS_COLORS: Record<string, string> = {
    attempt: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    success: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    failure: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    validation_rejected: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
}

const UPLOAD_STATUS_ICONS: Record<string, string> = {
    attempt: '⏳',
    success: '✅',
    failure: '❌',
    validation_rejected: '🚫',
}

const CLOCK_STATUS_COLORS: Record<string, string> = {
    pass: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    success: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    fail: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    info: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
}

const CLOCK_STATUS_ICONS: Record<string, string> = {
    pass: '✅',
    success: '✅',
    fail: '❌',
    info: 'ℹ️',
}

const CLOCK_STEP_LABELS: Record<string, string> = {
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

function getClockStatusColor(status: string): string {
    return CLOCK_STATUS_COLORS[status] || 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
}

function getEnvFromLog(log: ClockDebugLog): EnvInfo | null {
    return (log.details?.env as EnvInfo | undefined) || null
}

function formatBrowserShort(log: ClockDebugLog): string {
    const env = getEnvFromLog(log)
    if (env?.browser) return `${env.browser} ${env.browserVersion || ''}`.trim()
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
    return 'Browser'
}

function getActionColor(action: string): string {
    return ACTION_COLORS[action] || ACTION_COLORS.default
}

function getEventColor(eventType: string): string {
    return EVENT_COLORS[eventType] || EVENT_COLORS.default
}

function getUploadStatusColor(status: string): string {
    return UPLOAD_STATUS_COLORS[status] || 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
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
        hour12: true,
    })
}

function formatUserAgent(ua: string | null): string {
    if (!ua) return 'Unknown'

    if (ua.includes('Chrome')) return 'Chrome'
    if (ua.includes('Firefox')) return 'Firefox'
    if (ua.includes('Safari')) return 'Safari'
    if (ua.includes('Edge')) return 'Edge'
    if (ua.includes('Mobile')) return 'Mobile Browser'
    return 'Browser'
}

function formatFileSize(bytes: number | null): string {
    if (bytes === null || bytes === undefined) return 'Unknown'
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
}

function formatDuration(ms: number | null): string {
    if (ms === null || ms === undefined) return '-'
    if (ms < 1000) return ms + 'ms'
    return (ms / 1000).toFixed(1) + 's'
}

function formatUploadContext(context: string | null): string {
    if (!context) return 'Unknown'
    return context.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export default function ActivityLogsPage() {
    const [activeTab, setActiveTab] = useState<'admin' | 'usage' | 'uploads' | 'clock'>('admin')
    const [filter, setFilter] = useState<string>('all')
    const [expandedLog, setExpandedLog] = useState<string | null>(null)
    const [clockActionFilter, setClockActionFilter] = useState('all')
    const [clockStatusFilter, setClockStatusFilter] = useState('all')
    const [clockEmployeeFilter, setClockEmployeeFilter] = useState('all')

    // Fetch admin activity logs
    const { data: activityLogs = [], isLoading: activityLoading } = useSWR<ActivityLog[]>(
        activeTab === 'admin' ? ['admin:activity-logs', filter] : null,
        async () => {
            const supabase = createUntypedClient()
            let query = supabase
                .from('activity_logs')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(100)

            if (filter !== 'all') {
                query = query.eq('action', filter)
            }

            const { data, error } = await query
            if (error) throw error
            return data || []
        },
        { revalidateOnFocus: false }
    )

    // Fetch usage logs
    const { data: usageLogs = [], isLoading: usageLoading } = useSWR<UsageLog[]>(
        activeTab === 'usage' ? ['admin:usage-logs', filter] : null,
        async () => {
            const supabase = createUntypedClient()
            let query = supabase
                .from('usage_logs')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(200)

            if (filter !== 'all') {
                query = query.eq('event_type', filter)
            }

            const { data, error } = await query
            if (error) throw error
            return data || []
        },
        { revalidateOnFocus: false }
    )

    // Fetch upload logs
    const { data: uploadLogs = [], isLoading: uploadLoading } = useSWR<UploadLog[]>(
        activeTab === 'uploads' ? ['admin:upload-logs', filter] : null,
        async () => {
            const res = await fetch(`/api/upload-logs?status=${filter}&limit=200`)
            if (!res.ok) throw new Error('Failed to fetch upload logs')
            return res.json()
        },
        { revalidateOnFocus: false }
    )

    // Fetch clock debug logs
    const { data: clockLogs = [], isLoading: clockLoading } = useSWR<ClockDebugLog[]>(
        activeTab === 'clock' ? ['admin:clock-debug-logs', clockActionFilter, clockStatusFilter, clockEmployeeFilter] : null,
        async () => {
            const params = new URLSearchParams()
            if (clockEmployeeFilter !== 'all') params.set('employee', clockEmployeeFilter)
            if (clockActionFilter !== 'all') params.set('action', clockActionFilter)
            if (clockStatusFilter !== 'all') params.set('status', clockStatusFilter)
            params.set('limit', '200')
            const res = await fetch(`/api/clock-debug-log?${params.toString()}`)
            if (!res.ok) throw new Error('Failed to fetch clock debug logs')
            return res.json()
        },
        { revalidateOnFocus: false, refreshInterval: 30000 }
    )

    // Group clock logs by session (same employee + action within 60s)
    const groupedClockLogs = clockLogs.reduce<{ sessionKey: string; logs: ClockDebugLog[] }[]>((groups, log) => {
        const lastGroup = groups[groups.length - 1]
        if (
            lastGroup &&
            lastGroup.logs[0].employee_id === log.employee_id &&
            lastGroup.logs[0].action === log.action &&
            Math.abs(new Date(lastGroup.logs[lastGroup.logs.length - 1].created_at).getTime() - new Date(log.created_at).getTime()) < 60000
        ) {
            lastGroup.logs.push(log)
        } else {
            groups.push({ sessionKey: `${log.employee_id}-${log.action}-${log.created_at}`, logs: [log] })
        }
        return groups
    }, [])

    // Unique employees for clock filter
    const clockUniqueEmployees = Array.from(
        new Map(clockLogs.map(l => [l.employee_id, l.employee_email])).entries()
    )

    const isLoading = activeTab === 'admin' ? activityLoading : activeTab === 'usage' ? usageLoading : activeTab === 'uploads' ? uploadLoading : clockLoading

    return (
        <div className="space-y-4 sm:space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold">Activity Logs</h1>
                    <p className="text-muted-foreground mt-1 text-sm sm:text-base">
                        Track admin actions, user activity, and file uploads
                    </p>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 border-b">
                <button
                    onClick={() => { setActiveTab('admin'); setFilter('all'); setExpandedLog(null); }}
                    className={`px-4 py-2 font-medium text-sm transition-colors ${
                        activeTab === 'admin'
                            ? 'text-primary border-b-2 border-primary'
                            : 'text-muted-foreground hover:text-foreground'
                    }`}
                >
                    Admin Actions
                </button>
                <button
                    onClick={() => { setActiveTab('usage'); setFilter('all'); setExpandedLog(null); }}
                    className={`px-4 py-2 font-medium text-sm transition-colors ${
                        activeTab === 'usage'
                            ? 'text-primary border-b-2 border-primary'
                            : 'text-muted-foreground hover:text-foreground'
                    }`}
                >
                    User Activity
                </button>
                <button
                    onClick={() => { setActiveTab('uploads'); setFilter('all'); setExpandedLog(null); }}
                    className={`px-4 py-2 font-medium text-sm transition-colors ${
                        activeTab === 'uploads'
                            ? 'text-primary border-b-2 border-primary'
                            : 'text-muted-foreground hover:text-foreground'
                    }`}
                >
                    Upload Logs
                </button>
                <button
                    onClick={() => { setActiveTab('clock'); setFilter('all'); setExpandedLog(null); setClockActionFilter('all'); setClockStatusFilter('all'); setClockEmployeeFilter('all'); }}
                    className={`px-4 py-2 font-medium text-sm transition-colors ${
                        activeTab === 'clock'
                            ? 'text-primary border-b-2 border-primary'
                            : 'text-muted-foreground hover:text-foreground'
                    }`}
                >
                    Clock Logs
                </button>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap justify-end gap-3">
                {activeTab === 'admin' ? (
                    <select
                        className="input w-full sm:w-56"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                    >
                        <option value="all">All Activities</option>
                        <optgroup label="Employee Actions">
                            <option value="employee_created">Employee Created</option>
                            <option value="employee_deleted">Employee Deleted</option>
                            <option value="employee_deactivated">Employee Deactivated</option>
                            <option value="employee_updated">Employee Updated</option>
                            <option value="device_cleared">Device Cleared</option>
                        </optgroup>
                        <optgroup label="Task Actions">
                            <option value="task_created">Task Created</option>
                            <option value="task_updated">Task Updated</option>
                            <option value="task_deleted">Task Deleted</option>
                            <option value="task_assigned">Task Assigned</option>
                            <option value="task_bulk_assigned">Bulk Assigned</option>
                            <option value="task_bulk_deleted">Bulk Deleted</option>
                            <option value="task_instance_status_updated">Status Changed</option>
                            <option value="task_instance_deleted">Instance Deleted</option>
                            <option value="task_completed">Task Completed</option>
                            <option value="task_submission_updated">Submission Updated</option>
                            <option value="task_media_auto_deleted">Media Auto-Deleted</option>
                            <option value="tasks_loaded">Tasks Loaded</option>
                            <option value="tasks_load_failed">Tasks Load Failed</option>
                        </optgroup>
                    </select>
                ) : activeTab === 'usage' ? (
                    <select
                        className="input w-full sm:w-48"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                    >
                        <option value="all">All Events</option>
                        <option value="page_view">Page Views</option>
                        <option value="button_click">Button Clicks</option>
                        <option value="form_submit">Form Submissions</option>
                        <option value="feature_use">Feature Usage</option>
                        <option value="error">Errors</option>
                    </select>
                ) : activeTab === 'uploads' ? (
                    <select
                        className="input w-full sm:w-48"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                    >
                        <option value="all">All Uploads</option>
                        <option value="success">Successful</option>
                        <option value="failure">Failed</option>
                        <option value="validation_rejected">Rejected</option>
                        <option value="attempt">Attempts</option>
                    </select>
                ) : (
                    <>
                        <select className="input w-full sm:w-44" value={clockActionFilter} onChange={(e) => setClockActionFilter(e.target.value)}>
                            <option value="all">All Actions</option>
                            <option value="clock_in">Clock In</option>
                            <option value="clock_out">Clock Out</option>
                        </select>
                        <select className="input w-full sm:w-44" value={clockStatusFilter} onChange={(e) => setClockStatusFilter(e.target.value)}>
                            <option value="all">All Statuses</option>
                            <option value="fail">Failed Only</option>
                            <option value="pass">Passed Only</option>
                            <option value="info">Info Only</option>
                            <option value="success">Success Only</option>
                        </select>
                        {clockUniqueEmployees.length > 1 && (
                            <select className="input w-full sm:w-52" value={clockEmployeeFilter} onChange={(e) => setClockEmployeeFilter(e.target.value)}>
                                <option value="all">All Employees</option>
                                {clockUniqueEmployees.map(([id, email]) => (
                                    <option key={id} value={id}>{email}</option>
                                ))}
                            </select>
                        )}
                    </>
                )}
            </div>

            {isLoading ? (
                <div className="space-y-3">
                    {[...Array(5)].map((_, i) => (
                        <div key={i} className="h-20 bg-muted rounded-lg animate-pulse"></div>
                    ))}
                </div>
            ) : activeTab === 'admin' ? (
                /* Admin Activity Logs */
                activityLogs.length === 0 ? (
                    <div className="card p-8 text-center">
                        <div className="text-4xl mb-4">📋</div>
                        <p className="text-muted-foreground">No admin activity logs found</p>
                        <p className="text-sm text-muted-foreground mt-1">
                            Activity will appear here when admin actions are performed
                        </p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {activityLogs.map((log) => (
                            <div
                                key={log.id}
                                className="card p-4 hover:bg-muted/30 transition-colors cursor-pointer"
                                onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}
                            >
                                <div className="flex items-start gap-4">
                                    <div className="flex-shrink-0">
                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${getActionColor(log.action)}`}>
                                            {log.action === 'task_assigned' || log.action === 'task_bulk_assigned' ? '📋' :
                                             log.action === 'task_completed' ? '✅' :
                                             log.action === 'task_instance_status_updated' ? '🔄' :
                                             log.action === 'task_submission_updated' ? '📝' :
                                             log.action === 'tasks_loaded' ? '📂' :
                                             log.action === 'tasks_load_failed' ? '❌' :
                                             log.action.includes('created') ? '➕' :
                                             log.action.includes('deleted') ? '🗑️' :
                                             log.action.includes('deactivated') ? '⏸️' :
                                             log.action.includes('reactivated') ? '▶️' :
                                             log.action.includes('updated') ? '✏️' :
                                             log.action.includes('device') ? '📱' :
                                             log.action.includes('password') ? '🔑' : '📌'}
                                        </div>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${getActionColor(log.action)}`}>
                                                {formatAction(log.action)}
                                            </span>
                                            {log.entity_name && (
                                                <span className="font-medium text-sm truncate">
                                                    {log.entity_name}
                                                </span>
                                            )}
                                        </div>
                                        <div className="mt-1 text-sm text-muted-foreground">
                                            by <span className="font-medium">{log.admin_email}</span>
                                        </div>
                                        <div className="mt-1 text-xs text-muted-foreground flex flex-wrap gap-2">
                                            <span>{formatDate(log.created_at)}</span>
                                            {log.ip_address && (
                                                <span className="hidden sm:inline">• IP: {log.ip_address}</span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex-shrink-0">
                                        <svg
                                            xmlns="http://www.w3.org/2000/svg"
                                            className={`h-5 w-5 text-muted-foreground transition-transform ${expandedLog === log.id ? 'rotate-180' : ''}`}
                                            fill="none"
                                            viewBox="0 0 24 24"
                                            stroke="currentColor"
                                        >
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                        </svg>
                                    </div>
                                </div>

                                {expandedLog === log.id && log.details && (
                                    <div className="mt-4 pt-4 border-t">
                                        <h4 className="text-sm font-medium mb-2">Details</h4>
                                        <div className="bg-muted/50 rounded-lg p-3 text-sm">
                                            <pre className="whitespace-pre-wrap break-words text-xs">
                                                {JSON.stringify(log.details, null, 2)}
                                            </pre>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )
            ) : activeTab === 'usage' ? (
                /* Usage Logs */
                usageLogs.length === 0 ? (
                    <div className="card p-8 text-center">
                        <div className="text-4xl mb-4">📊</div>
                        <p className="text-muted-foreground">No user activity logs found</p>
                        <p className="text-sm text-muted-foreground mt-1">
                            Activity will appear here as users interact with the app
                        </p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {usageLogs.map((log) => (
                            <div
                                key={log.id}
                                className="card p-3 hover:bg-muted/30 transition-colors cursor-pointer"
                                onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}
                            >
                                <div className="flex items-center gap-3">
                                    <div className="flex-shrink-0 text-xl">
                                        {EVENT_ICONS[log.event_type] || '📌'}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${getEventColor(log.event_type)}`}>
                                                {log.event_type.replace('_', ' ')}
                                            </span>
                                            <span className="text-xs text-muted-foreground">
                                                {log.event_category}
                                            </span>
                                            {log.event_label && (
                                                <span className="font-medium text-sm truncate">
                                                    {log.event_label}
                                                </span>
                                            )}
                                        </div>
                                        <div className="mt-0.5 text-xs text-muted-foreground flex flex-wrap gap-2">
                                            <span>{log.user_email || 'Anonymous'}</span>
                                            <span className="hidden sm:inline">•</span>
                                            <span className="hidden sm:inline">{log.page_path}</span>
                                            <span>• {formatDate(log.created_at)}</span>
                                        </div>
                                    </div>
                                    <div className="flex-shrink-0">
                                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                                            log.user_role === 'admin' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400' :
                                            'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
                                        }`}>
                                            {log.user_role || 'guest'}
                                        </span>
                                    </div>
                                </div>

                                {expandedLog === log.id && (
                                    <div className="mt-3 pt-3 border-t text-xs space-y-1">
                                        <div><strong>Action:</strong> {log.event_action}</div>
                                        <div><strong>Page:</strong> {log.page_path}</div>
                                        {log.ip_address && <div><strong>IP:</strong> {log.ip_address}</div>}
                                        {log.user_agent && <div><strong>Browser:</strong> {formatUserAgent(log.user_agent)}</div>}
                                        {log.session_id && <div><strong>Session:</strong> {log.session_id}</div>}
                                        {log.metadata && (
                                            <div className="mt-2">
                                                <strong>Metadata:</strong>
                                                <pre className="bg-muted/50 rounded p-2 mt-1 whitespace-pre-wrap break-words">
                                                    {JSON.stringify(log.metadata, null, 2)}
                                                </pre>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )
            ) : activeTab === 'uploads' ? (
                /* Upload Logs */
                uploadLogs.length === 0 ? (
                    <div className="card p-8 text-center">
                        <div className="text-4xl mb-4">📤</div>
                        <p className="text-muted-foreground">No upload logs found</p>
                        <p className="text-sm text-muted-foreground mt-1">
                            Upload activity will appear here when files are uploaded
                        </p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {uploadLogs.map((log) => (
                            <div
                                key={log.id}
                                className="card p-3 hover:bg-muted/30 transition-colors cursor-pointer"
                                onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}
                            >
                                <div className="flex items-center gap-3">
                                    <div className="flex-shrink-0 text-xl">
                                        {UPLOAD_STATUS_ICONS[log.status] || '📤'}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${getUploadStatusColor(log.status)}`}>
                                                {log.status.replace('_', ' ')}
                                            </span>
                                            <span className="font-medium text-sm truncate">
                                                {log.file_name || 'Unknown file'}
                                            </span>
                                            {log.file_size !== null && (
                                                <span className="text-xs text-muted-foreground">
                                                    {formatFileSize(log.file_size)}
                                                </span>
                                            )}
                                        </div>
                                        <div className="mt-0.5 text-xs text-muted-foreground flex flex-wrap gap-2">
                                            <span>{log.user_email || 'Anonymous'}</span>
                                            {log.device_name && (
                                                <>
                                                    <span className="hidden sm:inline">•</span>
                                                    <span className="hidden sm:inline">{log.device_name}</span>
                                                </>
                                            )}
                                            {log.duration_ms !== null && (
                                                <>
                                                    <span>•</span>
                                                    <span>{formatDuration(log.duration_ms)}</span>
                                                </>
                                            )}
                                            <span>• {formatDate(log.created_at)}</span>
                                        </div>
                                        {log.error_message && log.status === 'failure' && (
                                            <div className="mt-0.5 text-xs text-red-600 dark:text-red-400 truncate">
                                                {log.error_message}
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex-shrink-0">
                                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                                            log.user_role === 'admin' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400' :
                                            'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
                                        }`}>
                                            {log.user_role || 'guest'}
                                        </span>
                                    </div>
                                </div>

                                {expandedLog === log.id && (
                                    <div className="mt-3 pt-3 border-t text-xs space-y-1">
                                        <div><strong>Context:</strong> {formatUploadContext(log.upload_context)}</div>
                                        <div><strong>MIME Type:</strong> {log.mime_type || 'Unknown'}</div>
                                        <div><strong>Bucket:</strong> {log.bucket || 'Unknown'}</div>
                                        {log.file_path && <div><strong>File Path:</strong> {log.file_path}</div>}
                                        {log.entity_id && <div><strong>Entity ID:</strong> {log.entity_id}</div>}
                                        {log.duration_ms !== null && <div><strong>Duration:</strong> {formatDuration(log.duration_ms)}</div>}
                                        {log.ip_address && <div><strong>IP:</strong> {log.ip_address}</div>}
                                        {log.user_agent && <div><strong>Browser:</strong> {formatUserAgent(log.user_agent)}</div>}
                                        {log.device_name && <div><strong>Device:</strong> {log.device_name}</div>}
                                        {log.error_message && (
                                            <div className="mt-2">
                                                <strong>Error:</strong>
                                                <pre className="bg-red-50 dark:bg-red-900/20 rounded p-2 mt-1 whitespace-pre-wrap break-words text-red-700 dark:text-red-300">
                                                    {log.error_message}
                                                    {log.error_code ? `\nCode: ${log.error_code}` : ''}
                                                </pre>
                                            </div>
                                        )}
                                        {log.error_message && log.status === 'validation_rejected' && (
                                            <div className="mt-2">
                                                <strong>Rejection Reason:</strong>
                                                <span className="ml-1 text-yellow-700 dark:text-yellow-300">{log.error_message}</span>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )
            ) : (
                /* Clock Debug Logs */
                clockLogs.length === 0 ? (
                    <div className="card p-8 text-center">
                        <div className="text-4xl mb-4">🕐</div>
                        <p className="text-muted-foreground">No clock debug logs found</p>
                        <p className="text-sm text-muted-foreground mt-1">
                            Logs will appear here when employees attempt to clock in or out
                        </p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {groupedClockLogs.map((group) => {
                            const firstLog = group.logs[0]
                            const hasFail = group.logs.some(l => l.status === 'fail')
                            const isComplete = group.logs.some(l => l.step === 'complete')
                            const isExpanded = expandedLog === group.sessionKey
                            const env = getEnvFromLog(firstLog)

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
                                                            : 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400'
                                                    }`}>
                                                        {firstLog.action === 'clock_in' ? 'Clock In' : 'Clock Out'}
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
                                                        <span className="hidden sm:inline">• {firstLog.device_name}</span>
                                                    )}
                                                    <span className="hidden sm:inline">
                                                        • {env?.platform === 'mobile' ? '📱' : env?.platform === 'tablet' ? '📱' : '💻'} {formatBrowserShort(firstLog)}
                                                    </span>
                                                    {env?.os && (
                                                        <span className="hidden sm:inline">• {env.os}</span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2 flex-shrink-0">
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
                                                            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs flex-shrink-0 ${getClockStatusColor(log.status)}`}>
                                                                {CLOCK_STATUS_ICONS[log.status] || '•'}
                                                            </div>
                                                            {idx < group.logs.length - 1 && (
                                                                <div className="w-0.5 flex-1 bg-border min-h-[16px]"></div>
                                                            )}
                                                        </div>

                                                        {/* Step content */}
                                                        <div className="pb-3 flex-1 min-w-0">
                                                            <div className="flex flex-wrap items-center gap-2">
                                                                <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${getClockStatusColor(log.status)}`}>
                                                                    {log.status.toUpperCase()}
                                                                </span>
                                                                <span className="text-sm font-medium">
                                                                    {CLOCK_STEP_LABELS[log.step] || log.step}
                                                                </span>
                                                            </div>
                                                            <p className="text-sm text-muted-foreground mt-0.5">
                                                                {log.message}
                                                            </p>
                                                            {log.details && (() => {
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
                                                                    hour12: true,
                                                                })}
                                                            </span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>

                                            {/* Session metadata — environment info */}
                                            <div className="mt-3 pt-3 border-t text-xs text-muted-foreground">
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                                                    <div><strong>Employee ID:</strong> {firstLog.employee_id}</div>
                                                    {firstLog.ip_address && <div><strong>IP Address:</strong> {firstLog.ip_address}</div>}
                                                    {firstLog.device_id && <div><strong>Device ID:</strong> {firstLog.device_id}</div>}
                                                    {firstLog.device_name && <div><strong>Device Name:</strong> {firstLog.device_name}</div>}

                                                    {env?.browser && <div><strong>Browser:</strong> {env.browser} {env.browserVersion}</div>}
                                                    {env?.os && <div><strong>OS:</strong> {env.os}</div>}
                                                    {env?.platform && (
                                                        <div><strong>Platform:</strong> {env.platform === 'mobile' ? '📱 Mobile' : env.platform === 'tablet' ? '📱 Tablet' : '💻 Desktop'}</div>
                                                    )}
                                                    {env?.screenWidth && (
                                                        <div><strong>Screen:</strong> {env.screenWidth}x{env.screenHeight} @ {env.devicePixelRatio}x DPR</div>
                                                    )}
                                                    {env?.viewportWidth && (
                                                        <div><strong>Viewport:</strong> {env.viewportWidth}x{env.viewportHeight} ({env.orientation})</div>
                                                    )}
                                                    {env?.connectionEffective && (
                                                        <div><strong>Connection:</strong> {env.connectionEffective}{env.connectionDownlink ? ` (${env.connectionDownlink} Mbps)` : ''}</div>
                                                    )}
                                                    {env?.connectionType && <div><strong>Network:</strong> {env.connectionType}</div>}
                                                    <div><strong>Online:</strong> {env?.online !== undefined ? (env.online ? 'Yes' : 'No') : 'Unknown'}</div>
                                                    {env?.language && <div><strong>Language:</strong> {env.language}</div>}
                                                    {env?.timezone && <div><strong>Timezone:</strong> {env.timezone} (UTC{env.timezoneOffset !== undefined ? (env.timezoneOffset <= 0 ? '+' : '-') + Math.abs(env.timezoneOffset / 60) : '?'})</div>}
                                                    {env?.touchSupport !== undefined && <div><strong>Touch:</strong> {env.touchSupport ? 'Yes' : 'No'}</div>}
                                                    {env?.cookiesEnabled !== undefined && <div><strong>Cookies:</strong> {env.cookiesEnabled ? 'Enabled' : 'Disabled'}</div>}
                                                    {env?.localStorage !== undefined && <div><strong>LocalStorage:</strong> {env.localStorage ? 'Available' : 'Unavailable'}</div>}
                                                    {env?.serviceWorker !== undefined && <div><strong>Service Worker:</strong> {env.serviceWorker ? 'Supported' : 'Not supported'}</div>}
                                                </div>

                                                {firstLog.user_agent && (
                                                    <details className="mt-2">
                                                        <summary className="cursor-pointer text-xs font-medium">Full User Agent</summary>
                                                        <p className="mt-1 bg-muted/50 rounded p-2 break-all text-[11px] font-mono">{firstLog.user_agent}</p>
                                                    </details>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                )
            )}
        </div>
    )
}
