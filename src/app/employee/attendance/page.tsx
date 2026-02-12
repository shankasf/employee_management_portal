'use client'

import { useState, useRef, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { createUntypedClient } from '@/lib/supabase/client'
import { formatLocationStatus } from '@/lib/geolocation'
import useSWR from 'swr'

const supabase = createUntypedClient()

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

// Get hourly rate from environment
const DEFAULT_HOURLY_RATE = parseFloat(process.env.NEXT_PUBLIC_HOURLY_RATE || '15.00')

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

export default function EmployeeTimeCardPage() {
    const { user, employee, isLoading: authLoading } = useAuth()
    const [filterType, setFilterType] = useState<'month' | 'range'>('month')
    const [selectedMonth, setSelectedMonth] = useState(() => {
        const now = new Date()
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    })
    const [dateRange, setDateRange] = useState(() => {
        const now = new Date()
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)
        return {
            start: firstDay.toISOString().slice(0, 10),
            end: now.toISOString().slice(0, 10),
        }
    })
    const [loadingTimeout, setLoadingTimeout] = useState(false)
    const tableRef = useRef<HTMLDivElement>(null)

    // Add timeout to prevent infinite loading state
    useEffect(() => {
        const timer = setTimeout(() => {
            if (authLoading) {
                setLoadingTimeout(true)
            }
        }, 5000)
        return () => clearTimeout(timer)
    }, [authLoading])

    // Get employee's hourly rate (fallback to env variable)
    const hourlyRate = employee?.hourly_rate || DEFAULT_HOURLY_RATE

    // Fetch time card data (include hourlyRate in key so it re-fetches when rate loads)
    const filterKey = filterType === 'month'
        ? ['employee:timecard', user?.id, 'month', selectedMonth, hourlyRate]
        : ['employee:timecard', user?.id, 'range', dateRange.start, dateRange.end, hourlyRate]

    const { data: timeCardData, isLoading: timeCardLoading } = useSWR(
        user?.id ? filterKey : null,
        async () => {
            let startDate: string
            let endDate: string

            if (filterType === 'month') {
                const [year, month] = selectedMonth.split('-').map(Number)
                startDate = new Date(year, month - 1, 1).toISOString()
                endDate = new Date(year, month, 0, 23, 59, 59, 999).toISOString()
            } else {
                startDate = `${dateRange.start}T00:00:00.000Z`
                endDate = `${dateRange.end}T23:59:59.999Z`
            }

            const { data, error } = await supabase
                .from('attendance_logs')
                .select('*')
                .eq('employee_id', user!.id)
                .gte('clock_in', startDate)
                .lte('clock_in', endDate)
                .order('clock_in', { ascending: true })

            if (error) throw error

            const entries = (data || []) as TimeCardEntry[]

            // Calculate totals
            let totalHours = 0
            let totalOT = 0
            let totalBreak = 0

            entries.forEach((entry) => {
                const hours = entry.total_hours || 0
                totalHours += hours
                if (hours > 8) totalOT += hours - 8
                totalBreak += entry.break_minutes || 0
            })

            return {
                entries,
                totals: {
                    totalHours,
                    totalOT,
                    totalBreak,
                    totalEarned: totalHours * hourlyRate,
                    daysWorked: entries.filter((e) => e.clock_out).length,
                }
            }
        },
        {
            revalidateOnFocus: false,
            keepPreviousData: true,
            dedupingInterval: 60000,
        }
    )

    const timeCardEntries = timeCardData?.entries || []
    const monthlyTotals = timeCardData?.totals || {
        totalHours: 0, totalOT: 0, totalBreak: 0, totalEarned: 0, daysWorked: 0
    }

    // Format hours to readable format
    function formatHours(hours: number | null): string {
        if (hours === null || hours === undefined) return '-'
        const totalMinutes = Math.round(hours * 60)
        const h = Math.floor(totalMinutes / 60)
        const m = totalMinutes % 60
        return `${h}h ${m}m`
    }

    // Format currency
    function formatCurrency(amount: number): string {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
    }

    // Export to CSV
    function exportToCSV() {
        const csvCell = (val: string) => `"${val.replace(/"/g, '""')}"`
        const csvRow = (cells: string[]) => cells.map(csvCell).join(',')

        const headers = ['Date', 'Status', 'Type', 'Clock In', 'Clock Out', 'OT', 'Break', 'Hours', 'Hourly Rate', 'Earned', 'Location']
        const rows = timeCardEntries.map(entry => {
            const hours = entry.total_hours || 0
            const ot = hours > 8 ? hours - 8 : 0
            const earned = hours * hourlyRate
            const clockInDate = new Date(entry.clock_in)
            const clockOutDate = entry.clock_out ? new Date(entry.clock_out) : null
            const locationIn = formatLocationStatus(entry.clock_in_location_status)

            return csvRow([
                clockInDate.toLocaleDateString(),
                entry.clock_out ? 'Complete' : 'In Progress',
                entry.work_type || 'Regular',
                clockInDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
                clockOutDate ? clockOutDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : '-',
                formatHours(ot),
                `${entry.break_minutes || 0}m`,
                formatHours(hours),
                formatCurrency(hourlyRate),
                formatCurrency(earned),
                locationIn.text,
            ])
        })

        rows.push('')
        rows.push(csvRow([
            'TOTALS', '', '', '', '',
            formatHours(monthlyTotals.totalOT),
            `${monthlyTotals.totalBreak}m`,
            formatHours(monthlyTotals.totalHours),
            '',
            formatCurrency(monthlyTotals.totalEarned),
            '',
        ]))

        const csvContent = [csvRow(headers), ...rows].join('\n')
        const blob = new Blob([csvContent], { type: 'text/csv' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        const datePart = filterType === 'month' ? selectedMonth : `${dateRange.start}_to_${dateRange.end}`
        a.download = `timecard-${datePart}.csv`
        a.click()
        URL.revokeObjectURL(url)
    }

    // Export to PDF
    function exportToPDF() {
        const printContent = tableRef.current
        if (!printContent) return

        const printWindow = window.open('', '_blank')
        if (!printWindow) {
            alert('Please allow popups to export PDF')
            return
        }

        const employeeName = employee?.display_name || 'Employee'
        let periodLabel: string
        if (filterType === 'month') {
            const [year, month] = selectedMonth.split('-').map(Number)
            periodLabel = new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
        } else {
            const startDate = new Date(dateRange.start)
            const endDate = new Date(dateRange.end)
            periodLabel = `${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
        }

        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Time Card - ${periodLabel}</title>
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
                    <strong>Employee:</strong> ${escapeHtml(employeeName)}<br>
                    <strong>Period:</strong> ${periodLabel}<br>
                    <strong>Generated:</strong> ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })} ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}
                </div>
                ${printContent.innerHTML}
                <div class="footer">PlayFunia Employee Management System</div>
            </body>
            </html>
        `)
        printWindow.document.close()
        printWindow.print()
    }

    // Show loading state while auth is loading
    if (authLoading && !loadingTimeout) {
        return (
            <div className="space-y-4 sm:space-y-6">
                <div className="h-12 bg-muted rounded-lg animate-pulse w-48"></div>
                <div className="h-10 bg-muted rounded-lg animate-pulse w-64"></div>
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                    {[...Array(5)].map((_, i) => (
                        <div key={i} className="h-24 bg-muted rounded-xl animate-pulse"></div>
                    ))}
                </div>
            </div>
        )
    }

    return (
        <div className="space-y-4 sm:space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold">My Time Card</h1>
                    <p className="text-muted-foreground mt-1 text-sm sm:text-base">
                        View your hours worked and earnings
                    </p>
                </div>
            </div>

            {/* Date Filter & Actions */}
            <div className="card p-4">
                <div className="flex flex-col gap-4">
                    {/* Filter Type Toggle */}
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-muted-foreground">Filter by:</span>
                        <div className="flex rounded-lg border overflow-hidden">
                            <button
                                onClick={() => setFilterType('month')}
                                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                                    filterType === 'month'
                                        ? 'bg-primary text-primary-foreground'
                                        : 'bg-background hover:bg-muted'
                                }`}
                            >
                                Month
                            </button>
                            <button
                                onClick={() => setFilterType('range')}
                                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                                    filterType === 'range'
                                        ? 'bg-primary text-primary-foreground'
                                        : 'bg-background hover:bg-muted'
                                }`}
                            >
                                Date Range
                            </button>
                        </div>
                    </div>

                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                        {/* Date Inputs */}
                        {filterType === 'month' ? (
                            <div className="flex items-center gap-3">
                                <label className="text-sm font-medium text-muted-foreground">Select Month:</label>
                                <input
                                    type="month"
                                    value={selectedMonth}
                                    onChange={(e) => setSelectedMonth(e.target.value)}
                                    className="input w-auto"
                                />
                            </div>
                        ) : (
                            <div className="flex flex-wrap items-center gap-3">
                                <div className="flex items-center gap-2">
                                    <label className="text-sm font-medium text-muted-foreground">From:</label>
                                    <input
                                        type="date"
                                        value={dateRange.start}
                                        onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                                        className="input w-auto"
                                    />
                                </div>
                                <div className="flex items-center gap-2">
                                    <label className="text-sm font-medium text-muted-foreground">To:</label>
                                    <input
                                        type="date"
                                        value={dateRange.end}
                                        onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                                        className="input w-auto"
                                    />
                                </div>
                            </div>
                        )}

                        {/* Export Buttons */}
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
                    {timeCardLoading && !timeCardEntries.length ? (
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
                            <p className="text-muted-foreground">No time entries for this period</p>
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
                                            <td className="px-4 py-3 text-sm font-mono">{clockInDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}</td>
                                            <td className="px-4 py-3 text-sm font-mono">{clockOutDate ? clockOutDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : '-'}</td>
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
                                    <td colSpan={5} className="px-4 py-3 text-sm">TOTALS</td>
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
    )
}
