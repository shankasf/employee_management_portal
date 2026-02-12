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

const ACTION_COLORS: Record<string, string> = {
    employee_created: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    employee_deleted: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    employee_deactivated: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    employee_reactivated: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    employee_updated: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    device_cleared: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
    password_reset_requested: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
    password_reset_completed: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
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

function getActionColor(action: string): string {
    return ACTION_COLORS[action] || ACTION_COLORS.default
}

function getEventColor(eventType: string): string {
    return EVENT_COLORS[eventType] || EVENT_COLORS.default
}

function formatDate(dateString: string): string {
    const date = new Date(dateString)
    return date.toLocaleString('en-US', {
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

export default function ActivityLogsPage() {
    const [activeTab, setActiveTab] = useState<'admin' | 'usage'>('admin')
    const [filter, setFilter] = useState<string>('all')
    const [expandedLog, setExpandedLog] = useState<string | null>(null)

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

    const isLoading = activeTab === 'admin' ? activityLoading : usageLoading

    return (
        <div className="space-y-4 sm:space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold">Activity Logs</h1>
                    <p className="text-muted-foreground mt-1 text-sm sm:text-base">
                        Track admin actions and user activity
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
            </div>

            {/* Filters */}
            <div className="flex justify-end">
                {activeTab === 'admin' ? (
                    <select
                        className="input w-full sm:w-48"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                    >
                        <option value="all">All Activities</option>
                        <option value="employee_created">Employee Created</option>
                        <option value="employee_deleted">Employee Deleted</option>
                        <option value="employee_deactivated">Employee Deactivated</option>
                        <option value="employee_updated">Employee Updated</option>
                        <option value="device_cleared">Device Cleared</option>
                    </select>
                ) : (
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
                                            {log.action.includes('created') && '➕'}
                                            {log.action.includes('deleted') && '🗑️'}
                                            {log.action.includes('deactivated') && '⏸️'}
                                            {log.action.includes('reactivated') && '▶️'}
                                            {log.action.includes('updated') && '✏️'}
                                            {log.action.includes('device') && '📱'}
                                            {log.action.includes('password') && '🔑'}
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
            ) : (
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
            )}
        </div>
    )
}
