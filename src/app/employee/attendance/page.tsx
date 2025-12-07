'use client'

import { useEffect, useState, useCallback } from 'react'
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
    const [logs, setLogs] = useState<AttendanceLog[]>([])
    const [loading, setLoading] = useState(true)
    const [month, setMonth] = useState<string>(
        new Date().toISOString().slice(0, 7) // YYYY-MM format
    )

    const loadAttendance = useCallback(async () => {
        setLoading(true)
        try {
            const supabase = createUntypedClient()
            const startDate = new Date(month + '-01')
            const endDate = new Date(startDate)
            endDate.setMonth(endDate.getMonth() + 1)

            const { data, error } = await supabase
                .from('attendance_logs')
                .select('*')
                .gte('clock_in', startDate.toISOString())
                .lt('clock_in', endDate.toISOString())
                .order('clock_in', { ascending: false })

            if (error) throw error
            setLogs(data || [])
        } catch (err) {
            console.error('Error loading attendance:', err)
        } finally {
            setLoading(false)
        }
    }, [month])

    useEffect(() => {
        loadAttendance()
    }, [loadAttendance])

    const totalHours = logs
        .filter((log) => log.total_hours)
        .reduce((sum, log) => sum + (log.total_hours || 0), 0)

    const completedShifts = logs.filter((log) => log.clock_out).length
    const lateArrivals = logs.filter((log) => log.late_flag).length

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold">My Attendance</h1>
                    <p className="text-muted-foreground mt-1">
                        View your attendance history
                    </p>
                </div>
                <div>
                    <input
                        type="month"
                        value={month}
                        onChange={(e) => setMonth(e.target.value)}
                        className="input w-auto"
                    />
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="card p-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Total Hours</p>
                            <p className="text-2xl font-bold">{totalHours.toFixed(1)}h</p>
                        </div>
                        <span className="text-2xl">⏱️</span>
                    </div>
                </div>
                <div className="card p-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Completed Shifts</p>
                            <p className="text-2xl font-bold">{completedShifts}</p>
                        </div>
                        <span className="text-2xl">✅</span>
                    </div>
                </div>
                <div className="card p-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Late Arrivals</p>
                            <p className="text-2xl font-bold">{lateArrivals}</p>
                        </div>
                        <span className="text-2xl">⚠️</span>
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="space-y-4">
                    {[...Array(5)].map((_, i) => (
                        <div key={i} className="h-16 bg-muted rounded-lg animate-pulse"></div>
                    ))}
                </div>
            ) : logs.length === 0 ? (
                <div className="card p-8 text-center">
                    <p className="text-muted-foreground">No attendance records for this month</p>
                </div>
            ) : (
                <div className="card overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-muted/50">
                                <tr>
                                    <th className="text-left p-4 font-medium">Date</th>
                                    <th className="text-left p-4 font-medium">Clock In</th>
                                    <th className="text-left p-4 font-medium">Clock Out</th>
                                    <th className="text-left p-4 font-medium">Hours</th>
                                    <th className="text-left p-4 font-medium">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {logs.map((log) => (
                                    <tr key={log.id} className="hover:bg-muted/30">
                                        <td className="p-4 font-medium">{formatDate(log.clock_in)}</td>
                                        <td className="p-4">{formatTime(log.clock_in)}</td>
                                        <td className="p-4">
                                            {log.clock_out ? formatTime(log.clock_out) : '-'}
                                        </td>
                                        <td className="p-4">
                                            {log.total_hours ? formatHours(log.total_hours) : '-'}
                                        </td>
                                        <td className="p-4">
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
            )}
        </div>
    )
}
