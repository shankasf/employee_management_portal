'use client'

import { useState, useRef } from 'react'
import { formatHours, formatDate, formatTime, getTodayNY } from '@/lib/utils'
import { useAttendance } from '@/lib/hooks/useData'

interface AttendanceLog {
    id: string
    employee_id: string
    clock_in: string
    clock_out: string | null
    total_hours: number | null
    late_flag: boolean
    early_checkout_flag: boolean
    employees: {
        id: string
        display_name: string | null
        position: string | null
    } | null
}

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

export default function AttendancePage() {
    const [dateFilter, setDateFilter] = useState<string>(getTodayNY())
    const { data: logs = [], isLoading: loading } = useAttendance(dateFilter)
    const [showExportMenu, setShowExportMenu] = useState(false)
    const tableRef = useRef<HTMLDivElement>(null)

    const currentlyClockedIn = logs.filter((log: AttendanceLog) => !log.clock_out)
    const completedShifts = logs.filter((log: AttendanceLog) => log.clock_out)
    const totalHours = completedShifts.reduce((sum: number, log: AttendanceLog) => sum + (log.total_hours || 0), 0)

    function exportToPDF() {
        setShowExportMenu(false)

        const printWindow = window.open('', '_blank')
        if (!printWindow) {
            alert('Please allow popups to export PDF')
            return
        }

        const dateStr = formatDate(dateFilter)

        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Attendance Report - ${dateStr}</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 20px; }
                    h1 { color: #4F46E5; margin-bottom: 5px; font-size: 24px; }
                    .meta { color: #666; margin-bottom: 20px; font-size: 14px; }
                    .summary { display: flex; gap: 30px; margin-bottom: 20px; padding: 15px; background: #f5f5f5; border-radius: 8px; }
                    .summary-item { text-align: center; }
                    .summary-label { font-size: 12px; color: #666; }
                    .summary-value { font-size: 24px; font-weight: bold; color: #333; }
                    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                    th, td { border: 1px solid #ddd; padding: 10px; text-align: left; font-size: 13px; }
                    th { background-color: #4F46E5; color: white; }
                    tr:nth-child(even) { background-color: #f9f9f9; }
                    .badge { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 500; }
                    .badge-success { background: #DEF7EC; color: #03543F; }
                    .badge-warning { background: #FEF3C7; color: #92400E; }
                    .badge-default { background: #E5E7EB; color: #374151; }
                    .footer { margin-top: 30px; text-align: center; color: #999; font-size: 12px; }
                    @media print { body { padding: 0; } }
                </style>
            </head>
            <body>
                <h1>Attendance Report</h1>
                <p class="meta">Date: ${dateStr} | Generated: ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}</p>

                <div class="summary">
                    <div class="summary-item">
                        <div class="summary-label">Currently Clocked In</div>
                        <div class="summary-value">${currentlyClockedIn.length}</div>
                    </div>
                    <div class="summary-item">
                        <div class="summary-label">Completed Shifts</div>
                        <div class="summary-value">${completedShifts.length}</div>
                    </div>
                    <div class="summary-item">
                        <div class="summary-label">Total Hours</div>
                        <div class="summary-value">${totalHours.toFixed(1)}h</div>
                    </div>
                </div>

                <table>
                    <thead>
                        <tr>
                            <th>Employee</th>
                            <th>Position</th>
                            <th>Clock In</th>
                            <th>Clock Out</th>
                            <th>Hours</th>
                            <th>Status</th>
                            <th>Flags</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${logs.map((log: AttendanceLog) => `
                            <tr>
                                <td>${escapeHtml(log.employees?.display_name || 'Unknown')}</td>
                                <td>${escapeHtml(log.employees?.position || '-')}</td>
                                <td>${formatTime(log.clock_in)}</td>
                                <td>${log.clock_out ? formatTime(log.clock_out) : '-'}</td>
                                <td>${log.total_hours ? formatHours(log.total_hours) : '-'}</td>
                                <td><span class="badge ${log.clock_out ? 'badge-success' : 'badge-default'}">${log.clock_out ? 'Completed' : 'Working'}</span></td>
                                <td>
                                    ${log.late_flag ? '<span class="badge badge-warning">Late</span> ' : ''}
                                    ${log.early_checkout_flag ? '<span class="badge badge-warning">Early Out</span>' : ''}
                                    ${!log.late_flag && !log.early_checkout_flag ? '-' : ''}
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>

                <div class="footer">
                    PlayFunia Employee Management System
                </div>

                <script>
                    window.onload = function() { window.print(); }
                </script>
            </body>
            </html>
        `)
        printWindow.document.close()
    }

    function exportToExcel() {
        setShowExportMenu(false)

        // Create CSV content
        const headers = ['Employee', 'Position', 'Clock In', 'Clock Out', 'Hours', 'Status', 'Late', 'Early Out']
        const rows = logs.map((log: AttendanceLog) => [
            log.employees?.display_name || 'Unknown',
            log.employees?.position || '',
            formatTime(log.clock_in),
            log.clock_out ? formatTime(log.clock_out) : '',
            log.total_hours ? log.total_hours.toFixed(2) : '',
            log.clock_out ? 'Completed' : 'Working',
            log.late_flag ? 'Yes' : 'No',
            log.early_checkout_flag ? 'Yes' : 'No'
        ])

        // Add summary row
        rows.push([])
        rows.push(['Summary'])
        rows.push(['Total Records', logs.length.toString()])
        rows.push(['Currently Clocked In', currentlyClockedIn.length.toString()])
        rows.push(['Completed Shifts', completedShifts.length.toString()])
        rows.push(['Total Hours', totalHours.toFixed(2)])

        const csvContent = [
            headers.join(','),
            ...rows.map((row: string[]) => row.map((cell: string) => `"${cell.replace(/"/g, '""')}"`).join(','))
        ].join('\n')

        // Create and download file
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
        const link = document.createElement('a')
        const url = URL.createObjectURL(blob)
        link.setAttribute('href', url)
        link.setAttribute('download', `attendance_${dateFilter}.csv`)
        link.style.visibility = 'hidden'
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
    }

    return (
        <div className="space-y-4 sm:space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold">Attendance</h1>
                    <p className="text-muted-foreground mt-1 text-sm sm:text-base">
                        View and export attendance records
                    </p>
                </div>
                <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto">
                    <input
                        type="date"
                        value={dateFilter}
                        onChange={(e) => setDateFilter(e.target.value)}
                        className="input flex-1 sm:flex-none sm:w-auto"
                    />
                    <div className="relative">
                        <button
                            className="btn-outline text-xs sm:text-sm whitespace-nowrap inline-flex items-center gap-1"
                            onClick={() => setShowExportMenu(!showExportMenu)}
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                            Export
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                        </button>

                        {showExportMenu && (
                            <>
                                <div
                                    className="fixed inset-0 z-10"
                                    onClick={() => setShowExportMenu(false)}
                                />
                                <div className="absolute right-0 mt-2 w-48 bg-card border rounded-lg shadow-lg z-20 py-1">
                                    <button
                                        className="w-full px-4 py-2 text-left text-sm hover:bg-muted flex items-center gap-2"
                                        onClick={exportToPDF}
                                    >
                                        <svg className="w-4 h-4 text-red-500" fill="currentColor" viewBox="0 0 24 24">
                                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/>
                                            <path d="M8 12h8v2H8zm0 4h8v2H8z"/>
                                        </svg>
                                        Export as PDF
                                    </button>
                                    <button
                                        className="w-full px-4 py-2 text-left text-sm hover:bg-muted flex items-center gap-2"
                                        onClick={exportToExcel}
                                    >
                                        <svg className="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 24 24">
                                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/>
                                            <path d="M8 12h2v6H8zm4-2h2v8h-2zm-2 4h2v4h-2z"/>
                                        </svg>
                                        Export as Excel (CSV)
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-3 gap-2 sm:gap-4">
                <div className="card p-3 sm:p-4">
                    <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                            <p className="text-xs sm:text-sm text-muted-foreground truncate">Clocked In</p>
                            <p className="text-lg sm:text-2xl font-bold">{currentlyClockedIn.length}</p>
                        </div>
                        <span className="text-lg sm:text-2xl flex-shrink-0">🟢</span>
                    </div>
                </div>
                <div className="card p-3 sm:p-4">
                    <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                            <p className="text-xs sm:text-sm text-muted-foreground truncate">Completed</p>
                            <p className="text-lg sm:text-2xl font-bold">{completedShifts.length}</p>
                        </div>
                        <span className="text-lg sm:text-2xl flex-shrink-0">✅</span>
                    </div>
                </div>
                <div className="card p-3 sm:p-4">
                    <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                            <p className="text-xs sm:text-sm text-muted-foreground truncate">Total Hours</p>
                            <p className="text-lg sm:text-2xl font-bold">
                                {totalHours.toFixed(1)}h
                            </p>
                        </div>
                        <span className="text-lg sm:text-2xl flex-shrink-0">⏱️</span>
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="space-y-3 sm:space-y-4">
                    {[...Array(5)].map((_, i) => (
                        <div key={i} className="h-14 sm:h-16 bg-muted rounded-lg animate-pulse"></div>
                    ))}
                </div>
            ) : logs.length === 0 ? (
                <div className="card p-6 sm:p-8 text-center">
                    <p className="text-muted-foreground text-sm sm:text-base">No attendance records for {formatDate(dateFilter)}</p>
                </div>
            ) : (
                <>
                    {/* Mobile Card View */}
                    <div className="block sm:hidden space-y-3">
                        {logs.map((log: AttendanceLog) => (
                            <div key={log.id} className="card p-4">
                                <div className="flex items-start justify-between gap-2 mb-2">
                                    <div className="min-w-0">
                                        <p className="font-medium truncate text-sm">{log.employees?.display_name || 'Unknown'}</p>
                                        <p className="text-xs text-muted-foreground">{log.employees?.position || '-'}</p>
                                    </div>
                                    {log.clock_out ? (
                                        <span className="badge-success text-xs">Completed</span>
                                    ) : (
                                        <span className="badge-default text-xs">Working</span>
                                    )}
                                </div>
                                <div className="grid grid-cols-3 gap-2 text-xs">
                                    <div>
                                        <span className="text-muted-foreground block">In</span>
                                        <span className="font-medium">{formatTime(log.clock_in)}</span>
                                    </div>
                                    <div>
                                        <span className="text-muted-foreground block">Out</span>
                                        <span className="font-medium">{log.clock_out ? formatTime(log.clock_out) : '-'}</span>
                                    </div>
                                    <div>
                                        <span className="text-muted-foreground block">Hours</span>
                                        <span className="font-medium">{log.total_hours ? formatHours(log.total_hours) : '-'}</span>
                                    </div>
                                </div>
                                {(log.late_flag || log.early_checkout_flag) && (
                                    <div className="flex gap-1 mt-2">
                                        {log.late_flag && <span className="badge-warning text-xs">Late</span>}
                                        {log.early_checkout_flag && <span className="badge-warning text-xs">Early Out</span>}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Desktop Table View */}
                    <div ref={tableRef} className="card overflow-hidden hidden sm:block">
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[600px]">
                                <thead className="bg-muted/50">
                                    <tr>
                                        <th className="text-left p-3 sm:p-4 font-medium text-sm">Employee</th>
                                        <th className="text-left p-3 sm:p-4 font-medium text-sm">Clock In</th>
                                        <th className="text-left p-3 sm:p-4 font-medium text-sm">Clock Out</th>
                                        <th className="text-left p-3 sm:p-4 font-medium text-sm">Hours</th>
                                        <th className="text-left p-3 sm:p-4 font-medium text-sm">Status</th>
                                        <th className="text-left p-3 sm:p-4 font-medium text-sm">Flags</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {logs.map((log: AttendanceLog) => (
                                        <tr key={log.id} className="hover:bg-muted/30">
                                            <td className="p-3 sm:p-4">
                                                <div>
                                                    <p className="font-medium text-sm">{log.employees?.display_name || 'Unknown'}</p>
                                                    <p className="text-xs text-muted-foreground">{log.employees?.position || '-'}</p>
                                                </div>
                                            </td>
                                            <td className="p-3 sm:p-4 text-sm">{formatTime(log.clock_in)}</td>
                                            <td className="p-3 sm:p-4 text-sm">
                                                {log.clock_out ? formatTime(log.clock_out) : '-'}
                                            </td>
                                            <td className="p-3 sm:p-4 text-sm">
                                                {log.total_hours ? formatHours(log.total_hours) : '-'}
                                            </td>
                                            <td className="p-3 sm:p-4">
                                                {log.clock_out ? (
                                                    <span className="badge-success">Completed</span>
                                                ) : (
                                                    <span className="badge-default">Working</span>
                                                )}
                                            </td>
                                            <td className="p-3 sm:p-4">
                                                <div className="flex gap-1 flex-wrap">
                                                    {log.late_flag && (
                                                        <span className="badge-warning text-xs">Late</span>
                                                    )}
                                                    {log.early_checkout_flag && (
                                                        <span className="badge-warning text-xs">Early Out</span>
                                                    )}
                                                    {!log.late_flag && !log.early_checkout_flag && (
                                                        <span className="text-muted-foreground text-sm">-</span>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}
