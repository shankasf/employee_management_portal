'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { createUntypedClient } from '@/lib/supabase/client'
import { ScheduleStatus } from '@/types/supabase'
import { formatLocationStatus } from '@/lib/geolocation'

// Types
interface Schedule {
    id: string
    employee_id: string
    schedule_date: string
    start_time: string
    end_time: string
    title: string | null
    description: string | null
    location: string | null
    status: ScheduleStatus
    confirmed_at: string | null
    cancellation_requested_at: string | null
    cancellation_reason: string | null
    created_at: string
}

interface TimeCardEntry {
    id: string
    employee_id: string
    clock_in: string
    clock_out: string | null
    total_hours: number | null
    break_minutes: number
    work_type: string
    clock_in_location_status: string | null
    clock_out_location_status: string | null
    notes: string | null
    late_flag: boolean
    early_checkout_flag: boolean
}

interface MonthlyTotals {
    totalHours: number
    totalOT: number
    totalBreak: number
    totalEarned: number
    daysWorked: number
}

// Status styling
const statusColors: Record<ScheduleStatus, string> = {
    pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
    confirmed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    cancellation_requested: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    cancelled: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
    completed: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
}

const statusLabels: Record<ScheduleStatus, string> = {
    pending: 'Awaiting Confirmation',
    confirmed: 'Confirmed',
    cancellation_requested: 'Cancellation Pending',
    cancelled: 'Cancelled',
    completed: 'Completed',
}

// Get hourly rate from environment
const DEFAULT_HOURLY_RATE = parseFloat(process.env.NEXT_PUBLIC_HOURLY_RATE || '15.00')

export default function EmployeeSchedulesPage() {
    const { user, employee } = useAuth()
    const [activeTab, setActiveTab] = useState<'schedule' | 'timecard'>('schedule')

    // Schedule state
    const [schedules, setSchedules] = useState<Schedule[]>([])
    const [scheduleLoading, setScheduleLoading] = useState(true)
    const [processing, setProcessing] = useState<string | null>(null)
    const [showCancelModal, setShowCancelModal] = useState(false)
    const [cancellingSchedule, setCancellingSchedule] = useState<Schedule | null>(null)
    const [cancellationReason, setCancellationReason] = useState('')
    const [scheduleFilter, setScheduleFilter] = useState<'upcoming' | 'all' | 'pending'>('upcoming')

    // Time Card state
    const [timeCardEntries, setTimeCardEntries] = useState<TimeCardEntry[]>([])
    const [timeCardLoading, setTimeCardLoading] = useState(false)
    const [selectedMonth, setSelectedMonth] = useState(() => {
        const now = new Date()
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    })
    const [monthlyTotals, setMonthlyTotals] = useState<MonthlyTotals>({
        totalHours: 0,
        totalOT: 0,
        totalBreak: 0,
        totalEarned: 0,
        daysWorked: 0,
    })
    const tableRef = useRef<HTMLDivElement>(null)

    // Get employee's hourly rate (fallback to env variable)
    const hourlyRate = employee?.hourly_rate || DEFAULT_HOURLY_RATE

    const loadSchedules = useCallback(async () => {
        if (!user) return
        setScheduleLoading(true)
        try {
            const supabase = createUntypedClient()
            let query = supabase
                .from('schedules')
                .select('*')
                .eq('employee_id', user.id)
                .order('schedule_date', { ascending: true })
                .order('start_time', { ascending: true })

            if (scheduleFilter === 'upcoming') {
                const today = new Date().toISOString().split('T')[0]
                query = query.gte('schedule_date', today).neq('status', 'cancelled')
            } else if (scheduleFilter === 'pending') {
                query = query.eq('status', 'pending')
            }

            const { data, error } = await query
            if (error) throw error
            setSchedules(data || [])
        } catch (err) {
            console.error('Error loading schedules:', err)
        } finally {
            setScheduleLoading(false)
        }
    }, [user, scheduleFilter])

    const loadTimeCard = useCallback(async () => {
        if (!user) return
        setTimeCardLoading(true)
        try {
            const supabase = createUntypedClient()

            // Parse month
            const [year, month] = selectedMonth.split('-').map(Number)
            const startOfMonth = new Date(year, month - 1, 1).toISOString()
            const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999).toISOString()

            const { data, error } = await supabase
                .from('attendance_logs')
                .select('*')
                .eq('employee_id', user.id)
                .gte('clock_in', startOfMonth)
                .lte('clock_in', endOfMonth)
                .order('clock_in', { ascending: true })

            if (error) throw error

            const entries = data || []
            setTimeCardEntries(entries)

            // Calculate totals
            let totalHours = 0
            let totalOT = 0
            let totalBreak = 0

            entries.forEach((entry: TimeCardEntry) => {
                const hours = entry.total_hours || 0
                totalHours += hours
                if (hours > 8) {
                    totalOT += hours - 8
                }
                totalBreak += entry.break_minutes || 0
            })

            setMonthlyTotals({
                totalHours,
                totalOT,
                totalBreak,
                totalEarned: totalHours * hourlyRate,
                daysWorked: entries.filter((e: TimeCardEntry) => e.clock_out).length,
            })
        } catch (err) {
            console.error('Error loading time card:', err)
        } finally {
            setTimeCardLoading(false)
        }
    }, [user, selectedMonth, hourlyRate])

    // Load schedules
    useEffect(() => {
        if (user && activeTab === 'schedule') {
            loadSchedules()
        }
    }, [user, scheduleFilter, activeTab, loadSchedules])

    // Load time card when tab changes or month changes
    useEffect(() => {
        if (user && activeTab === 'timecard') {
            loadTimeCard()
        }
    }, [user, selectedMonth, activeTab, loadTimeCard])

    async function handleConfirm(scheduleId: string) {
        setProcessing(scheduleId)
        try {
            const supabase = createUntypedClient()
            const { error } = await supabase
                .from('schedules')
                .update({
                    status: 'confirmed',
                    confirmed_at: new Date().toISOString(),
                })
                .eq('id', scheduleId)
                .eq('employee_id', user?.id)
                .eq('status', 'pending')

            if (error) throw error
            alert('Schedule confirmed!')
            loadSchedules()
        } catch (err: unknown) {
            const error = err as Error
            console.error('Error confirming schedule:', error)
            alert('Error: ' + error.message)
        } finally {
            setProcessing(null)
        }
    }

    async function handleRequestCancellation(e: React.FormEvent) {
        e.preventDefault()
        if (!cancellingSchedule || !cancellationReason.trim()) return
        setProcessing(cancellingSchedule.id)

        try {
            const supabase = createUntypedClient()
            const { error } = await supabase
                .from('schedules')
                .update({
                    status: 'cancellation_requested',
                    cancellation_requested_at: new Date().toISOString(),
                    cancellation_reason: cancellationReason,
                })
                .eq('id', cancellingSchedule.id)
                .eq('employee_id', user?.id)

            if (error) throw error
            alert('Cancellation request submitted.')
            setShowCancelModal(false)
            setCancellingSchedule(null)
            setCancellationReason('')
            loadSchedules()
        } catch (err: unknown) {
            const error = err as Error
            console.error('Error requesting cancellation:', error)
            alert('Error: ' + error.message)
        } finally {
            setProcessing(null)
        }
    }

    // Format hours to readable format
    function formatHours(hours: number | null): string {
        if (hours === null || hours === undefined) return '-'
        const h = Math.floor(hours)
        const m = Math.round((hours - h) * 60)
        return `${h}h ${m}m`
    }

    // Format currency
    function formatCurrency(amount: number): string {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
        }).format(amount)
    }

    // Export to CSV
    function exportToCSV() {
        const headers = ['Date', 'Status', 'Type', 'Clock In', 'Clock Out', 'OT', 'Break', 'Hours', 'Hourly Rate', 'Earned', 'Location']
        const rows = timeCardEntries.map(entry => {
            const hours = entry.total_hours || 0
            const ot = hours > 8 ? hours - 8 : 0
            const earned = hours * hourlyRate
            const clockInDate = new Date(entry.clock_in)
            const clockOutDate = entry.clock_out ? new Date(entry.clock_out) : null
            const locationIn = formatLocationStatus(entry.clock_in_location_status)

            return [
                clockInDate.toLocaleDateString(),
                entry.clock_out ? 'Complete' : 'In Progress',
                entry.work_type || 'Regular',
                clockInDate.toLocaleTimeString(),
                clockOutDate ? clockOutDate.toLocaleTimeString() : '-',
                formatHours(ot),
                `${entry.break_minutes || 0}m`,
                formatHours(hours),
                formatCurrency(hourlyRate),
                formatCurrency(earned),
                locationIn.text,
            ].join(',')
        })

        // Add totals row
        rows.push('')
        rows.push([
            'TOTALS',
            '',
            '',
            '',
            '',
            formatHours(monthlyTotals.totalOT),
            `${monthlyTotals.totalBreak}m`,
            formatHours(monthlyTotals.totalHours),
            '',
            formatCurrency(monthlyTotals.totalEarned),
            '',
        ].join(','))

        const csvContent = [headers.join(','), ...rows].join('\n')
        const blob = new Blob([csvContent], { type: 'text/csv' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `timecard-${selectedMonth}.csv`
        a.click()
        URL.revokeObjectURL(url)
    }

    // Export to PDF (simple print-based approach)
    function exportToPDF() {
        const printContent = tableRef.current
        if (!printContent) return

        const printWindow = window.open('', '_blank')
        if (!printWindow) {
            alert('Please allow popups to export PDF')
            return
        }

        const employeeName = employee?.display_name || 'Employee'
        const monthName = new Date(selectedMonth + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Time Card - ${monthName}</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 20px; }
                    h1 { color: #4F46E5; margin-bottom: 5px; }
                    .meta { color: #666; margin-bottom: 20px; }
                    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 12px; }
                    th { background-color: #4F46E5; color: white; }
                    tr:nth-child(even) { background-color: #f9f9f9; }
                    .totals { background-color: #EEF2FF; font-weight: bold; }
                    .footer { margin-top: 20px; font-size: 11px; color: #999; }
                </style>
            </head>
            <body>
                <h1>Time Card Report</h1>
                <div class="meta">
                    <strong>Employee:</strong> ${employeeName}<br>
                    <strong>Period:</strong> ${monthName}<br>
                    <strong>Generated:</strong> ${new Date().toLocaleString()}
                </div>
                ${printContent.innerHTML}
                <div class="footer">PlayFunia Employee Management System</div>
            </body>
            </html>
        `)
        printWindow.document.close()
        printWindow.print()
    }

    // Get shift info for display
    const shiftInfo = employee ? {
        type: employee.shift_type,
        start: employee.shift_start,
        end: employee.shift_end,
    } : null

    const pendingCount = schedules.filter(s => s.status === 'pending').length

    return (
        <div className="space-y-4 sm:space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold">My Schedule</h1>
                    <p className="text-muted-foreground mt-1 text-sm sm:text-base">
                        View schedules and time card
                    </p>
                </div>
                {pendingCount > 0 && (
                    <div className="px-3 py-1 rounded-full bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300 text-sm font-medium">
                        {pendingCount} pending confirmation{pendingCount > 1 ? 's' : ''}
                    </div>
                )}
            </div>

            {/* Tab Navigation */}
            <div className="border-b border-border">
                <nav className="flex gap-1" aria-label="Tabs">
                    <button
                        onClick={() => setActiveTab('schedule')}
                        className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                            activeTab === 'schedule'
                                ? 'border-primary text-primary'
                                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                        }`}
                    >
                        <span className="flex items-center gap-2">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            My Schedule
                        </span>
                    </button>
                    <button
                        onClick={() => setActiveTab('timecard')}
                        className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                            activeTab === 'timecard'
                                ? 'border-primary text-primary'
                                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                        }`}
                    >
                        <span className="flex items-center gap-2">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            My Time Card
                        </span>
                    </button>
                </nav>
            </div>

            {/* Schedule Tab Content */}
            {activeTab === 'schedule' && (
                <div className="space-y-4">
                    {/* Shift Info Card */}
                    {shiftInfo && (shiftInfo.type || shiftInfo.start) && (
                        <div className="card p-4 bg-gradient-to-r from-primary/5 to-primary/10 border-primary/20">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-primary/10">
                                    <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                </div>
                                <div>
                                    <h3 className="font-semibold text-sm">Your Regular Shift</h3>
                                    <p className="text-sm text-muted-foreground">
                                        {shiftInfo.type && <span>{shiftInfo.type} • </span>}
                                        {shiftInfo.start && shiftInfo.end && <span>{shiftInfo.start} - {shiftInfo.end}</span>}
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Filter Tabs */}
                    <div className="flex gap-2 flex-wrap">
                        {(['upcoming', 'pending', 'all'] as const).map((filter) => (
                            <button
                                key={filter}
                                onClick={() => setScheduleFilter(filter)}
                                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                                    scheduleFilter === filter
                                        ? 'bg-primary text-primary-foreground'
                                        : 'bg-muted hover:bg-muted/80 text-muted-foreground'
                                }`}
                            >
                                {filter === 'upcoming' && 'Upcoming'}
                                {filter === 'pending' && (
                                    <span className="flex items-center gap-1">
                                        Needs Confirmation
                                        {pendingCount > 0 && (
                                            <span className="px-1.5 py-0.5 rounded-full bg-yellow-500 text-white text-xs">
                                                {pendingCount}
                                            </span>
                                        )}
                                    </span>
                                )}
                                {filter === 'all' && 'All'}
                            </button>
                        ))}
                    </div>

                    {/* Schedules List */}
                    {scheduleLoading ? (
                        <div className="space-y-3">
                            {[...Array(3)].map((_, i) => (
                                <div key={i} className="h-28 bg-muted rounded-xl animate-pulse"></div>
                            ))}
                        </div>
                    ) : schedules.length === 0 ? (
                        <div className="card p-8 text-center">
                            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
                                <svg className="w-8 h-8 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                            </div>
                            <p className="text-muted-foreground">
                                {scheduleFilter === 'pending' ? 'No schedules awaiting confirmation' :
                                 scheduleFilter === 'upcoming' ? 'No upcoming schedules' : 'No schedules found'}
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {schedules.map((schedule) => {
                                const scheduleDate = new Date(schedule.schedule_date)
                                const isToday = schedule.schedule_date === new Date().toISOString().split('T')[0]
                                const isTomorrow = schedule.schedule_date === new Date(Date.now() + 86400000).toISOString().split('T')[0]

                                return (
                                    <div
                                        key={schedule.id}
                                        className={`card p-4 transition-all hover:shadow-md ${
                                            isToday ? 'ring-2 ring-primary shadow-lg' : ''
                                        }`}
                                    >
                                        <div className="flex flex-col sm:flex-row justify-between gap-4">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-2 flex-wrap">
                                                    {isToday && (
                                                        <span className="px-2 py-0.5 rounded-full bg-primary text-primary-foreground text-xs font-medium">
                                                            Today
                                                        </span>
                                                    )}
                                                    {isTomorrow && (
                                                        <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 text-xs font-medium">
                                                            Tomorrow
                                                        </span>
                                                    )}
                                                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[schedule.status]}`}>
                                                        {statusLabels[schedule.status]}
                                                    </span>
                                                </div>
                                                <p className="font-semibold text-lg">
                                                    {scheduleDate.toLocaleDateString('en-US', {
                                                        weekday: 'long',
                                                        month: 'short',
                                                        day: 'numeric',
                                                    })}
                                                </p>
                                                <p className="text-2xl font-bold text-primary mt-1">
                                                    {schedule.start_time} - {schedule.end_time}
                                                </p>
                                                {schedule.title && (
                                                    <p className="text-sm font-medium mt-2 text-muted-foreground">{schedule.title}</p>
                                                )}
                                                {schedule.location && (
                                                    <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                                        </svg>
                                                        {schedule.location}
                                                    </p>
                                                )}
                                            </div>
                                            <div className="flex gap-2 flex-shrink-0">
                                                {schedule.status === 'pending' && (
                                                    <button
                                                        className="btn-primary"
                                                        disabled={processing === schedule.id}
                                                        onClick={() => handleConfirm(schedule.id)}
                                                    >
                                                        {processing === schedule.id ? 'Confirming...' : 'Confirm'}
                                                    </button>
                                                )}
                                                {(schedule.status === 'pending' || schedule.status === 'confirmed') && (
                                                    <button
                                                        className="btn-secondary text-red-600 dark:text-red-400"
                                                        onClick={() => {
                                                            setCancellingSchedule(schedule)
                                                            setShowCancelModal(true)
                                                        }}
                                                    >
                                                        Request Cancel
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* Time Card Tab Content */}
            {activeTab === 'timecard' && (
                <div className="space-y-4">
                    {/* Month Selector & Actions */}
                    <div className="card p-4">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                            <div className="flex items-center gap-3">
                                <label className="text-sm font-medium text-muted-foreground">Select Month:</label>
                                <input
                                    type="month"
                                    value={selectedMonth}
                                    onChange={(e) => setSelectedMonth(e.target.value)}
                                    className="input w-auto"
                                />
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={exportToCSV}
                                    className="btn-secondary flex items-center gap-2"
                                    disabled={timeCardEntries.length === 0}
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                    </svg>
                                    Export CSV
                                </button>
                                <button
                                    onClick={exportToPDF}
                                    className="btn-primary flex items-center gap-2"
                                    disabled={timeCardEntries.length === 0}
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                                    </svg>
                                    Export PDF
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Summary Cards */}
                    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                        <div className="card p-4 bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 border-blue-200 dark:border-blue-800">
                            <p className="text-xs font-medium text-blue-600 dark:text-blue-400 uppercase tracking-wide">Days Worked</p>
                            <p className="text-2xl font-bold text-blue-900 dark:text-blue-100 mt-1">{monthlyTotals.daysWorked}</p>
                        </div>
                        <div className="card p-4 bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/20 border-green-200 dark:border-green-800">
                            <p className="text-xs font-medium text-green-600 dark:text-green-400 uppercase tracking-wide">Total Hours</p>
                            <p className="text-2xl font-bold text-green-900 dark:text-green-100 mt-1">{formatHours(monthlyTotals.totalHours)}</p>
                        </div>
                        <div className="card p-4 bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-900/20 dark:to-orange-800/20 border-orange-200 dark:border-orange-800">
                            <p className="text-xs font-medium text-orange-600 dark:text-orange-400 uppercase tracking-wide">Overtime</p>
                            <p className="text-2xl font-bold text-orange-900 dark:text-orange-100 mt-1">{formatHours(monthlyTotals.totalOT)}</p>
                        </div>
                        <div className="card p-4 bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-800/50 dark:to-gray-700/50 border-gray-200 dark:border-gray-700">
                            <p className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">Break Time</p>
                            <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">{monthlyTotals.totalBreak}m</p>
                        </div>
                        <div className="card p-4 bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-900/20 dark:to-purple-800/20 border-purple-200 dark:border-purple-800 col-span-2 lg:col-span-1">
                            <p className="text-xs font-medium text-purple-600 dark:text-purple-400 uppercase tracking-wide">Total Earned</p>
                            <p className="text-2xl font-bold text-purple-900 dark:text-purple-100 mt-1">{formatCurrency(monthlyTotals.totalEarned)}</p>
                        </div>
                    </div>

                    {/* Time Card Table */}
                    <div className="card overflow-hidden" ref={tableRef}>
                        <div className="overflow-x-auto">
                            {timeCardLoading ? (
                                <div className="p-8 text-center">
                                    <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full mx-auto"></div>
                                    <p className="mt-2 text-muted-foreground">Loading time card...</p>
                                </div>
                            ) : timeCardEntries.length === 0 ? (
                                <div className="p-8 text-center">
                                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
                                        <svg className="w-8 h-8 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                    </div>
                                    <p className="text-muted-foreground">No time entries for this month</p>
                                </div>
                            ) : (
                                <table className="w-full">
                                    <thead>
                                        <tr className="bg-primary text-primary-foreground">
                                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Date</th>
                                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Status</th>
                                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Type</th>
                                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Clock In</th>
                                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Clock Out</th>
                                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">OT</th>
                                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Break</th>
                                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Hours</th>
                                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Rate</th>
                                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Earned</th>
                                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Location</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {timeCardEntries.map((entry, index) => {
                                            const clockInDate = new Date(entry.clock_in)
                                            const clockOutDate = entry.clock_out ? new Date(entry.clock_out) : null
                                            const hours = entry.total_hours || 0
                                            const ot = hours > 8 ? hours - 8 : 0
                                            const earned = hours * hourlyRate
                                            const locationIn = formatLocationStatus(entry.clock_in_location_status)

                                            return (
                                                <tr key={entry.id} className={`${index % 2 === 0 ? 'bg-background' : 'bg-muted/30'} hover:bg-muted/50 transition-colors`}>
                                                    <td className="px-4 py-3 text-sm font-medium">
                                                        {clockInDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                                            entry.clock_out
                                                                ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                                                                : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300'
                                                        }`}>
                                                            {entry.clock_out ? 'Complete' : 'In Progress'}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-sm capitalize">{entry.work_type || 'Regular'}</td>
                                                    <td className="px-4 py-3 text-sm font-mono">{clockInDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</td>
                                                    <td className="px-4 py-3 text-sm font-mono">{clockOutDate ? clockOutDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '-'}</td>
                                                    <td className="px-4 py-3 text-sm">
                                                        {ot > 0 ? (
                                                            <span className="text-orange-600 dark:text-orange-400 font-medium">{formatHours(ot)}</span>
                                                        ) : '-'}
                                                    </td>
                                                    <td className="px-4 py-3 text-sm">{entry.break_minutes || 0}m</td>
                                                    <td className="px-4 py-3 text-sm font-semibold">{formatHours(hours)}</td>
                                                    <td className="px-4 py-3 text-sm">{formatCurrency(hourlyRate)}</td>
                                                    <td className="px-4 py-3 text-sm font-semibold text-green-600 dark:text-green-400">{formatCurrency(earned)}</td>
                                                    <td className="px-4 py-3">
                                                        <span className={`text-xs font-medium ${locationIn.color}`}>
                                                            {locationIn.text === 'GPS' ? (
                                                                <span className="flex items-center gap-1">
                                                                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                                                        <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                                                                    </svg>
                                                                    GPS
                                                                </span>
                                                            ) : locationIn.text}
                                                        </span>
                                                    </td>
                                                </tr>
                                            )
                                        })}
                                    </tbody>
                                    <tfoot>
                                        <tr className="bg-primary/10 font-semibold">
                                            <td colSpan={5} className="px-4 py-3 text-sm">MONTHLY TOTALS</td>
                                            <td className="px-4 py-3 text-sm text-orange-600 dark:text-orange-400">{formatHours(monthlyTotals.totalOT)}</td>
                                            <td className="px-4 py-3 text-sm">{monthlyTotals.totalBreak}m</td>
                                            <td className="px-4 py-3 text-sm font-bold">{formatHours(monthlyTotals.totalHours)}</td>
                                            <td className="px-4 py-3 text-sm">-</td>
                                            <td className="px-4 py-3 text-sm font-bold text-green-600 dark:text-green-400">{formatCurrency(monthlyTotals.totalEarned)}</td>
                                            <td className="px-4 py-3 text-sm">-</td>
                                        </tr>
                                    </tfoot>
                                </table>
                            )}
                        </div>
                    </div>

                    {/* Hourly Rate Info */}
                    <div className="text-sm text-muted-foreground text-center">
                        Current hourly rate: <span className="font-semibold">{formatCurrency(hourlyRate)}</span>/hour
                    </div>
                </div>
            )}

            {/* Cancellation Request Modal */}
            {showCancelModal && cancellingSchedule && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-card rounded-xl shadow-xl w-full max-w-md border">
                        <div className="p-6">
                            <h2 className="text-xl font-bold mb-4">Request Cancellation</h2>
                            <div className="mb-4 p-4 bg-muted rounded-lg">
                                <p className="font-semibold">
                                    {new Date(cancellingSchedule.schedule_date).toLocaleDateString('en-US', {
                                        weekday: 'long',
                                        year: 'numeric',
                                        month: 'short',
                                        day: 'numeric',
                                    })}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                    {cancellingSchedule.start_time} - {cancellingSchedule.end_time}
                                </p>
                            </div>
                            <form onSubmit={handleRequestCancellation} className="space-y-4">
                                <div>
                                    <label className="label">Reason for Cancellation *</label>
                                    <textarea
                                        required
                                        className="input min-h-[100px]"
                                        placeholder="Please explain why you need to cancel this schedule..."
                                        value={cancellationReason}
                                        onChange={(e) => setCancellationReason(e.target.value)}
                                    />
                                </div>
                                <p className="text-sm text-muted-foreground">
                                    Your request will be sent to management for approval.
                                </p>
                                <div className="flex gap-3">
                                    <button
                                        type="button"
                                        className="btn-secondary flex-1"
                                        onClick={() => {
                                            setShowCancelModal(false)
                                            setCancellingSchedule(null)
                                        }}
                                    >
                                        Back
                                    </button>
                                    <button
                                        type="submit"
                                        className="btn-destructive flex-1"
                                        disabled={processing === cancellingSchedule.id}
                                    >
                                        {processing === cancellingSchedule.id ? 'Submitting...' : 'Submit Request'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
