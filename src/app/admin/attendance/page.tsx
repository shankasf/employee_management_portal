'use client'

import { useState } from 'react'
import { formatHours, formatDate, formatTime } from '@/lib/utils'
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

export default function AttendancePage() {
    const [dateFilter, setDateFilter] = useState<string>(
        new Date().toISOString().split('T')[0]
    )
    const { data: logs = [], isLoading: loading } = useAttendance(dateFilter)

    const currentlyClockedIn = logs.filter((log: AttendanceLog) => !log.clock_out)
    const completedShifts = logs.filter((log: AttendanceLog) => log.clock_out)

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
                    <button className="btn-outline text-xs sm:text-sm whitespace-nowrap">
                        📥 Export
                    </button>
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
                                {completedShifts.reduce((sum: number, log: AttendanceLog) => sum + (log.total_hours || 0), 0).toFixed(1)}h
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
                    <div className="card overflow-hidden hidden sm:block">
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
