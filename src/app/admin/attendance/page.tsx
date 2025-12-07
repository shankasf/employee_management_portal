'use client'

import { useEffect, useState } from 'react'
import { createUntypedClient } from '@/lib/supabase/client'
import { formatHours, formatDate, formatTime } from '@/lib/utils'

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
    const [logs, setLogs] = useState<AttendanceLog[]>([])
    const [loading, setLoading] = useState(true)
    const [dateFilter, setDateFilter] = useState<string>(
        new Date().toISOString().split('T')[0]
    )

    useEffect(() => {
        loadAttendance()
    }, [dateFilter])

    async function loadAttendance() {
        setLoading(true)
        try {
            const supabase = createUntypedClient()
            const startOfDay = new Date(dateFilter)
            startOfDay.setHours(0, 0, 0, 0)
            const endOfDay = new Date(dateFilter)
            endOfDay.setHours(23, 59, 59, 999)

            const { data, error } = await supabase
                .from('attendance_logs')
                .select(`
          *,
          employees (
            id,
            display_name,
            position
          )
        `)
                .gte('clock_in', startOfDay.toISOString())
                .lte('clock_in', endOfDay.toISOString())
                .order('clock_in', { ascending: false })

            if (error) throw error
            setLogs(data || [])
        } catch (err) {
            console.error('Error loading attendance:', err)
        } finally {
            setLoading(false)
        }
    }

    const currentlyClockedIn = logs.filter((log) => !log.clock_out)
    const completedShifts = logs.filter((log) => log.clock_out)

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold">Attendance</h1>
                    <p className="text-muted-foreground mt-1">
                        View and export attendance records
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <input
                        type="date"
                        value={dateFilter}
                        onChange={(e) => setDateFilter(e.target.value)}
                        className="input w-auto"
                    />
                    <button className="btn-outline">
                        📥 Export
                    </button>
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="card p-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Currently Clocked In</p>
                            <p className="text-2xl font-bold">{currentlyClockedIn.length}</p>
                        </div>
                        <span className="text-2xl">🟢</span>
                    </div>
                </div>
                <div className="card p-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Completed Shifts</p>
                            <p className="text-2xl font-bold">{completedShifts.length}</p>
                        </div>
                        <span className="text-2xl">✅</span>
                    </div>
                </div>
                <div className="card p-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Total Hours</p>
                            <p className="text-2xl font-bold">
                                {completedShifts.reduce((sum, log) => sum + (log.total_hours || 0), 0).toFixed(1)}h
                            </p>
                        </div>
                        <span className="text-2xl">⏱️</span>
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
                    <p className="text-muted-foreground">No attendance records for {formatDate(dateFilter)}</p>
                </div>
            ) : (
                <div className="card overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-muted/50">
                                <tr>
                                    <th className="text-left p-4 font-medium">Employee</th>
                                    <th className="text-left p-4 font-medium">Clock In</th>
                                    <th className="text-left p-4 font-medium">Clock Out</th>
                                    <th className="text-left p-4 font-medium">Hours</th>
                                    <th className="text-left p-4 font-medium">Status</th>
                                    <th className="text-left p-4 font-medium">Flags</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {logs.map((log) => (
                                    <tr key={log.id} className="hover:bg-muted/30">
                                        <td className="p-4">
                                            <div>
                                                <p className="font-medium">{log.employees?.display_name || 'Unknown'}</p>
                                                <p className="text-xs text-muted-foreground">{log.employees?.position || '-'}</p>
                                            </div>
                                        </td>
                                        <td className="p-4">{formatTime(log.clock_in)}</td>
                                        <td className="p-4">
                                            {log.clock_out ? formatTime(log.clock_out) : '-'}
                                        </td>
                                        <td className="p-4">
                                            {log.total_hours ? formatHours(log.total_hours) : '-'}
                                        </td>
                                        <td className="p-4">
                                            {log.clock_out ? (
                                                <span className="badge-success">Completed</span>
                                            ) : (
                                                <span className="badge-default">Working</span>
                                            )}
                                        </td>
                                        <td className="p-4">
                                            <div className="flex gap-1">
                                                {log.late_flag && (
                                                    <span className="badge-warning text-xs">Late</span>
                                                )}
                                                {log.early_checkout_flag && (
                                                    <span className="badge-warning text-xs">Early Out</span>
                                                )}
                                                {!log.late_flag && !log.early_checkout_flag && (
                                                    <span className="text-muted-foreground">-</span>
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
