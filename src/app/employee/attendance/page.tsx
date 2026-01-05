'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { createUntypedClient } from '@/lib/supabase/client'
import { formatDate, formatTime, formatHours } from '@/lib/utils'

interface AttendanceLog {
    id: string
    clock_in: string
    clock_out: string | null
    total_hours: number | null
    late_flag: boolean
    early_checkout_flag: boolean
}

export default function EmployeeAttendancePage() {
    const { user, isLoading: authLoading } = useAuth()
    const [logs, setLogs] = useState<AttendanceLog[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [month, setMonth] = useState<string>(
        new Date().toISOString().slice(0, 7) // YYYY-MM format
    )

    const loadAttendance = useCallback(async () => {
        if (!user?.id) {
            setLoading(false)
            return
        }

        setLoading(true)
        setError(null)
        try {
            const supabase = createUntypedClient()

            // Parse month as YYYY-MM and create proper date range
            const [year, monthNum] = month.split('-').map(Number)
            const startDate = new Date(Date.UTC(year, monthNum - 1, 1, 0, 0, 0, 0))
            const endDate = new Date(Date.UTC(year, monthNum, 1, 0, 0, 0, 0)) // First day of next month

            const { data, error: fetchError } = await supabase
                .from('attendance_logs')
                .select('id, clock_in, clock_out, total_hours, late_flag, early_checkout_flag')
                .eq('employee_id', user.id)
                .gte('clock_in', startDate.toISOString())
                .lt('clock_in', endDate.toISOString())
                .order('clock_in', { ascending: false })

            if (fetchError) {
                console.error('Attendance fetch error:', fetchError)
                setError(`Failed to load attendance: ${fetchError.message}`)
                setLogs([])
                return
            }

            // Ensure we set the logs with the fetched data
            const logsData = data as AttendanceLog[] || []
            setLogs(logsData)
        } catch (err) {
            console.error('Error loading attendance:', err)
            setError('Failed to load attendance records')
            setLogs([])
        } finally {
            setLoading(false)
        }
    }, [month, user?.id])

    // Load attendance when user is available and auth is done loading
    useEffect(() => {
        if (!authLoading && user?.id) {
            loadAttendance()
        } else if (!authLoading && !user) {
            setLoading(false)
        }
    }, [authLoading, user, loadAttendance])

    const totalHours = logs
        .filter((log) => log.total_hours)
        .reduce((sum, log) => sum + (log.total_hours || 0), 0)

    const completedShifts = logs.filter((log) => log.clock_out).length
    const lateArrivals = logs.filter((log) => log.late_flag).length

    return (
        <div className="space-y-4 sm:space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold">My Attendance</h1>
                    <p className="text-muted-foreground mt-1 text-sm sm:text-base">
                        View your attendance history
                    </p>
                </div>
                <div className="flex gap-2 items-center">
                    <input
                        type="month"
                        value={month}
                        onChange={(e) => setMonth(e.target.value)}
                        className="input w-full sm:w-auto"
                    />
                    <button
                        onClick={loadAttendance}
                        disabled={loading}
                        className="btn-secondary px-3 py-2 text-sm"
                    >
                        🔄
                    </button>
                </div>
            </div>

            {error && (
                <div className="p-3 sm:p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-800 dark:text-red-200 text-sm">
                    ⚠️ {error}
                </div>
            )}

            {/* Summary Cards */}
            <div className="grid grid-cols-3 gap-2 sm:gap-4">
                <div className="card p-3 sm:p-4">
                    <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                            <p className="text-xs sm:text-sm text-muted-foreground truncate">Total Hours</p>
                            <p className="text-lg sm:text-2xl font-bold">{totalHours.toFixed(1)}h</p>
                        </div>
                        <span className="text-lg sm:text-2xl flex-shrink-0">⏱️</span>
                    </div>
                </div>
                <div className="card p-3 sm:p-4">
                    <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                            <p className="text-xs sm:text-sm text-muted-foreground truncate">Shifts</p>
                            <p className="text-lg sm:text-2xl font-bold">{completedShifts}</p>
                        </div>
                        <span className="text-lg sm:text-2xl flex-shrink-0">✅</span>
                    </div>
                </div>
                <div className="card p-3 sm:p-4">
                    <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                            <p className="text-xs sm:text-sm text-muted-foreground truncate">Late</p>
                            <p className="text-lg sm:text-2xl font-bold">{lateArrivals}</p>
                        </div>
                        <span className="text-lg sm:text-2xl flex-shrink-0">⚠️</span>
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
                    <p className="text-muted-foreground text-sm sm:text-base">No attendance records for this month</p>
                </div>
            ) : (
                <>
                    {/* Mobile Card View */}
                    <div className="block sm:hidden space-y-3">
                        {logs.map((log) => (
                            <div key={log.id} className="card p-4">
                                <div className="flex items-start justify-between gap-2 mb-2">
                                    <p className="font-medium text-sm">{formatDate(log.clock_in)}</p>
                                    <div className="flex gap-1 flex-wrap justify-end">
                                        {!log.clock_out && (
                                            <span className="badge-default text-xs">In Progress</span>
                                        )}
                                        {log.late_flag && (
                                            <span className="badge-warning text-xs">Late</span>
                                        )}
                                        {log.early_checkout_flag && (
                                            <span className="badge-warning text-xs">Early</span>
                                        )}
                                        {log.clock_out && !log.late_flag && !log.early_checkout_flag && (
                                            <span className="badge-success text-xs">Complete</span>
                                        )}
                                    </div>
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
                            </div>
                        ))}
                    </div>

                    {/* Desktop Table View */}
                    <div className="card overflow-hidden hidden sm:block">
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[500px]">
                                <thead className="bg-muted/50">
                                    <tr>
                                        <th className="text-left p-3 sm:p-4 font-medium text-sm">Date</th>
                                        <th className="text-left p-3 sm:p-4 font-medium text-sm">Clock In</th>
                                        <th className="text-left p-3 sm:p-4 font-medium text-sm">Clock Out</th>
                                        <th className="text-left p-3 sm:p-4 font-medium text-sm">Hours</th>
                                        <th className="text-left p-3 sm:p-4 font-medium text-sm">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {logs.map((log) => (
                                        <tr key={log.id} className="hover:bg-muted/30">
                                            <td className="p-3 sm:p-4 font-medium text-sm">{formatDate(log.clock_in)}</td>
                                            <td className="p-3 sm:p-4 text-sm">{formatTime(log.clock_in)}</td>
                                            <td className="p-3 sm:p-4 text-sm">
                                                {log.clock_out ? formatTime(log.clock_out) : '-'}
                                            </td>
                                            <td className="p-3 sm:p-4 text-sm">
                                                {log.total_hours ? formatHours(log.total_hours) : '-'}
                                            </td>
                                            <td className="p-3 sm:p-4">
                                                <div className="flex gap-1 flex-wrap">
                                                    {!log.clock_out && (
                                                        <span className="badge-default text-xs">In Progress</span>
                                                    )}
                                                    {log.late_flag && (
                                                        <span className="badge-warning text-xs">Late</span>
                                                    )}
                                                    {log.early_checkout_flag && (
                                                        <span className="badge-warning text-xs">Early Out</span>
                                                    )}
                                                    {log.clock_out && !log.late_flag && !log.early_checkout_flag && (
                                                        <span className="badge-success text-xs">Complete</span>
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
