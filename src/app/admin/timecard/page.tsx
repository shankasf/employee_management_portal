'use client'

import { useState, useMemo, useRef, useCallback } from 'react'
import { createUntypedClient } from '@/lib/supabase/client'
import { useEmployees } from '@/lib/hooks/useData'
import { formatDate, formatDateOnly, formatTime, formatShortDateWithWeekday, formatShortDate, getTodayNY, getCurrentMonthNY, getNYMonthBoundaries, getNYDayBoundary } from '@/lib/utils'
import { formatLocationStatus } from '@/lib/geolocation'
import useSWR from 'swr'

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
    clock_in_lat: number | null
    clock_in_lng: number | null
    clock_out_lat: number | null
    clock_out_lng: number | null
    clock_in_location_name: string | null
    clock_out_location_name: string | null
    notes: string | null
    late_flag: boolean
    early_checkout_flag: boolean
    actual_clock_out: string | null
    late_clock_out_minutes: number | null
    employee?: {
        id: string
        display_name: string | null
        position: string | null
        profiles?: {
            full_name: string | null
            email: string | null
        } | null
    } | null
}

interface Employee {
    id: string
    display_name: string | null
    position: string | null
    profiles: {
        full_name: string | null
        email: string | null
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

// In-memory geocode cache shared across fetcher calls
const geocodeCache = new Map<string, string>()

async function resolveLocation(lat: number | null, lng: number | null): Promise<string | null> {
    if (lat == null || lng == null) return null
    const key = `${lat.toFixed(3)},${lng.toFixed(3)}`
    if (geocodeCache.has(key)) return geocodeCache.get(key)!
    try {
        const res = await fetch(`/api/geocode?lat=${lat}&lng=${lng}`)
        if (!res.ok) throw new Error('failed')
        const data = await res.json()
        const label = data.location || `${lat.toFixed(4)}, ${lng.toFixed(4)}`
        geocodeCache.set(key, label)
        return label
    } catch {
        const fallback = `${lat.toFixed(4)}, ${lng.toFixed(4)}`
        geocodeCache.set(key, fallback)
        return fallback
    }
}

export default function AdminTimeCardPage() {
    const { data: employees = [] } = useEmployees(true) as { data: Employee[] }
    const tableRef = useRef<HTMLDivElement>(null)

    // Filters
    const [employeeFilter, setEmployeeFilter] = useState<string>('all')
    const [filterType, setFilterType] = useState<'month' | 'range'>('month')
    const [selectedMonth, setSelectedMonth] = useState(() => getCurrentMonthNY())
    const [dateRange, setDateRange] = useState(() => {
        const today = getTodayNY()
        const firstDay = today.slice(0, 8) + '01'
        return { start: firstDay, end: today }
    })

    // Edit modal state
    const [editingEntry, setEditingEntry] = useState<TimeCardEntry | null>(null)
    const [editClockIn, setEditClockIn] = useState('')
    const [editClockOut, setEditClockOut] = useState('')
    const [savingEdit, setSavingEdit] = useState(false)
    const [editError, setEditError] = useState('')

    // Convert ISO string to datetime-local value in NY timezone
    function isoToDatetimeLocal(iso: string): string {
        const d = new Date(iso)
        const ny = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }))
        const year = ny.getFullYear()
        const month = String(ny.getMonth() + 1).padStart(2, '0')
        const day = String(ny.getDate()).padStart(2, '0')
        const hours = String(ny.getHours()).padStart(2, '0')
        const minutes = String(ny.getMinutes()).padStart(2, '0')
        return `${year}-${month}-${day}T${hours}:${minutes}`
    }

    // Convert datetime-local value (interpreted as NY time) back to UTC ISO string
    function datetimeLocalToISO(dtLocal: string): string {
        // dtLocal is "YYYY-MM-DDTHH:mm"
        // We need to interpret this as NY time and convert to UTC
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/New_York',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false,
        })
        // Create a date assuming local browser time, then adjust
        const [datePart, timePart] = dtLocal.split('T')
        const [year, month, day] = datePart.split('-').map(Number)
        const [hours, minutes] = timePart.split(':').map(Number)

        // Use a brute-force approach: try the date and adjust for NY offset
        const guess = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0))
        // Format that guess in NY to see what NY time it corresponds to
        const parts = formatter.formatToParts(guess)
        const getPart = (type: string) => Number(parts.find(p => p.type === type)?.value || 0)
        const nyHour = getPart('hour')
        const nyMinute = getPart('minute')
        const nyDay = getPart('day')
        // Calculate the offset between what we want and what we got
        const wantedMinutes = hours * 60 + minutes
        const gotMinutes = nyHour * 60 + nyMinute
        let diffMinutes = wantedMinutes - gotMinutes
        // Handle day boundary crossings
        if (day !== nyDay) {
            if (day > nyDay) diffMinutes += 24 * 60
            else diffMinutes -= 24 * 60
        }
        return new Date(guess.getTime() + diffMinutes * 60000).toISOString()
    }

    const openEditModal = useCallback((entry: TimeCardEntry) => {
        setEditingEntry(entry)
        setEditClockIn(isoToDatetimeLocal(entry.clock_in))
        setEditClockOut(entry.clock_out ? isoToDatetimeLocal(entry.clock_out) : '')
        setEditError('')
    }, [])

    const closeEditModal = useCallback(() => {
        setEditingEntry(null)
        setEditClockIn('')
        setEditClockOut('')
        setEditError('')
        setSavingEdit(false)
    }, [])

    // Calculate preview hours for the edit modal
    const editPreviewHours = useMemo(() => {
        if (!editClockIn || !editClockOut || !editingEntry) return null
        const inDate = new Date(datetimeLocalToISO(editClockIn))
        const outDate = new Date(datetimeLocalToISO(editClockOut))
        if (isNaN(inDate.getTime()) || isNaN(outDate.getTime())) return null
        if (outDate <= inDate) return null
        const diffMs = outDate.getTime() - inDate.getTime()
        const breakMin = editingEntry.break_minutes || 0
        const hours = diffMs / 3600000 - breakMin / 60
        return Math.max(0, hours)
    }, [editClockIn, editClockOut, editingEntry])

    async function handleSaveEdit() {
        if (!editingEntry || !editClockIn) return
        setEditError('')

        const clockInISO = datetimeLocalToISO(editClockIn)
        const clockOutISO = editClockOut ? datetimeLocalToISO(editClockOut) : null

        // Client-side validation
        if (clockOutISO) {
            const inD = new Date(clockInISO)
            const outD = new Date(clockOutISO)
            if (outD <= inD) {
                setEditError('Clock-out must be after clock-in')
                return
            }
        }

        setSavingEdit(true)
        try {
            const res = await fetch('/api/admin/attendance', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: editingEntry.id,
                    clock_in: clockInISO,
                    clock_out: clockOutISO,
                }),
            })
            const data = await res.json()
            if (!res.ok) {
                setEditError(data.error || 'Failed to save')
                return
            }
            closeEditModal()
            refreshData()
        } catch {
            setEditError('Failed to save changes')
        } finally {
            setSavingEdit(false)
        }
    }

    // Fetch time card data based on filters
    const filterKey = useMemo(() =>
        filterType === 'month'
            ? ['admin:timecard', employeeFilter, 'month', selectedMonth]
            : ['admin:timecard', employeeFilter, 'range', dateRange.start, dateRange.end],
        [employeeFilter, filterType, selectedMonth, dateRange.start, dateRange.end]
    )

    const { data: timeCardData, isLoading: loading, mutate: refreshData } = useSWR(
        filterKey,
        async () => {
            const supabase = createUntypedClient()
            let startDate: string
            let endDate: string

            if (filterType === 'month') {
                const boundaries = getNYMonthBoundaries(selectedMonth)
                startDate = boundaries.start
                endDate = boundaries.end
            } else {
                startDate = getNYDayBoundary(dateRange.start, 'start')
                endDate = getNYDayBoundary(dateRange.end, 'end')
            }

            let query = supabase
                .from('attendance_logs')
                .select(`
                    id,
                    employee_id,
                    clock_in,
                    clock_out,
                    total_hours,
                    break_minutes,
                    work_type,
                    clock_in_location_status,
                    clock_out_location_status,
                    clock_in_lat,
                    clock_in_lng,
                    clock_out_lat,
                    clock_out_lng,
                    notes,
                    late_flag,
                    early_checkout_flag,
                    actual_clock_out,
                    late_clock_out_minutes,
                    employee:employees (
                        id,
                        display_name,
                        position,
                        profiles (
                            full_name,
                            email
                        )
                    )
                `)
                .gte('clock_in', startDate)
                .lte('clock_in', endDate)
                .order('clock_in', { ascending: true })

            if (employeeFilter !== 'all') {
                query = query.eq('employee_id', employeeFilter)
            }

            const { data, error } = await query

            if (error) {
                console.error('Error fetching time card data:', error)
                return { entries: [], totals: { totalHours: 0, totalBreak: 0, daysWorked: 0 } }
            }

            const rawEntries = (data || []) as TimeCardEntry[]

            // Resolve location names inside the fetcher (no useEffect needed)
            const entries = await Promise.all(rawEntries.map(async (entry) => {
                const clockInName = entry.clock_in_location_status === 'captured'
                    ? await resolveLocation(entry.clock_in_lat, entry.clock_in_lng)
                    : null
                const clockOutName = entry.clock_out_location_status === 'captured'
                    ? await resolveLocation(entry.clock_out_lat, entry.clock_out_lng)
                    : null
                return {
                    ...entry,
                    clock_in_location_name: clockInName,
                    clock_out_location_name: clockOutName,
                }
            }))

            // Calculate totals
            let totalHours = 0
            let totalBreak = 0

            entries.forEach((entry) => {
                const hours = entry.total_hours || 0
                totalHours += hours
                totalBreak += entry.break_minutes || 0
            })

            return {
                entries,
                totals: {
                    totalHours,
                    totalBreak,
                    daysWorked: new Set(entries.filter((e) => e.clock_out).map((e) => formatDate(e.clock_in))).size,
                }
            }
        },
        { revalidateOnFocus: false }
    )

    const timeCardEntries = timeCardData?.entries || []
    const monthlyTotals = timeCardData?.totals || {
        totalHours: 0, totalBreak: 0, daysWorked: 0
    }

    // Format hours to readable format
    function formatHours(hours: number | null): string {
        if (hours === null || hours === undefined) return '-'
        const totalMinutes = Math.round(hours * 60)
        const h = Math.floor(totalMinutes / 60)
        const m = totalMinutes % 60
        return `${h}h ${m}m`
    }

    // Helper to render a location value
    function renderLocation(status: string | null, name: string | null) {
        if (name) {
            return <span className="text-green-600">{name}</span>
        }
        const loc = formatLocationStatus(status)
        return <span className={loc.color}>{loc.icon ? `${loc.icon} ` : ''}{loc.text}</span>
    }

    // Export to CSV
    function exportToCSV() {
        const csvCell = (val: string) => `"${val.replace(/"/g, '""')}"`
        const csvRow = (cells: string[]) => cells.map(csvCell).join(',')

        const headers = ['Employee', 'Date', 'Status', 'Type', 'Clock In', 'Clock Out', 'Actual Clock Out', 'Late Out (min)', 'Break', 'Hours', 'Clock In Location', 'Clock Out Location']
        const rows = timeCardEntries.map(entry => {
            const hours = entry.total_hours || 0
            const empName = entry.employee?.display_name || entry.employee?.profiles?.full_name || 'Unknown'

            return csvRow([
                empName,
                formatShortDate(entry.clock_in),
                entry.clock_out ? 'Complete' : 'In Progress',
                entry.work_type || 'Regular',
                formatTime(entry.clock_in),
                entry.clock_out ? formatTime(entry.clock_out) : '-',
                entry.actual_clock_out ? formatTime(entry.actual_clock_out) : '',
                entry.late_clock_out_minutes ? entry.late_clock_out_minutes.toString() : '',
                `${entry.break_minutes || 0}m`,
                formatHours(hours),
                entry.clock_in_location_name || formatLocationStatus(entry.clock_in_location_status).text,
                entry.clock_out_location_name || formatLocationStatus(entry.clock_out_location_status).text,
            ])
        })

        rows.push('')
        rows.push(csvRow([
            'TOTALS', '', '', '', '', '', '', '',
            `${monthlyTotals.totalBreak}m`,
            formatHours(monthlyTotals.totalHours),
            '', '',
        ]))

        const csvContent = [csvRow(headers), ...rows].join('\n')
        const blob = new Blob([csvContent], { type: 'text/csv' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        const datePart = filterType === 'month' ? selectedMonth : `${dateRange.start}_to_${dateRange.end}`
        a.download = `timecard-${employeeFilter === 'all' ? 'all' : 'employee'}-${datePart}.csv`
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

        let periodLabel: string
        if (filterType === 'month') {
            const [year, month] = selectedMonth.split('-').map(Number)
            periodLabel = new Date(year, month - 1, 1).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'long', year: 'numeric' })
        } else {
            periodLabel = `${formatDateOnly(dateRange.start)} - ${formatDateOnly(dateRange.end)}`
        }
        const selectedEmp = employeeFilter !== 'all' ? employees.find(e => e.id === employeeFilter) : null
        const empName = selectedEmp ? (selectedEmp.display_name || selectedEmp.profiles?.full_name || 'Unknown') : 'All Employees'

        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Time Card Report - ${periodLabel}</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 20px; }
                    h1 { color: #4F46E5; margin-bottom: 5px; }
                    .meta { color: #666; margin-bottom: 20px; }
                    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 11px; }
                    th { background-color: #4F46E5; color: white; }
                    tr:nth-child(even) { background-color: #f9f9f9; }
                    .totals { background-color: #EEF2FF; font-weight: bold; }
                    .footer { margin-top: 20px; font-size: 11px; color: #999; }
                </style>
            </head>
            <body>
                <h1>Time Card Report</h1>
                <div class="meta">
                    <strong>Employee:</strong> ${escapeHtml(empName)}<br>
                    <strong>Period:</strong> ${periodLabel}<br>
                    <strong>Generated:</strong> ${new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'short', day: 'numeric' })} ${new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: true })}
                </div>
                ${printContent.innerHTML}
                <div class="footer">PlayFunia Employee Management System</div>
            </body>
            </html>
        `)
        printWindow.document.close()
        printWindow.print()
    }

    return (
        <div className="space-y-4 sm:space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold">Time Card</h1>
                    <p className="text-muted-foreground mt-1 text-sm sm:text-base">
                        View employee time card and attendance metrics
                    </p>
                </div>
            </div>

            {/* Filters & Actions */}
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

                    <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                        <div className="flex flex-wrap items-center gap-3">
                            <div className="flex items-center gap-2">
                                <label className="text-sm font-medium text-muted-foreground">Employee:</label>
                                <select
                                    className="input w-auto"
                                    value={employeeFilter}
                                    onChange={(e) => setEmployeeFilter(e.target.value)}
                                >
                                    <option value="all">All Employees</option>
                                    {employees.filter(emp => emp.id).map((emp) => (
                                        <option key={emp.id} value={emp.id}>
                                            {emp.display_name || emp.profiles?.full_name || 'Unknown'}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            {filterType === 'month' ? (
                                <div className="flex items-center gap-2">
                                    <label className="text-sm font-medium text-muted-foreground">Month:</label>
                                    <input
                                        type="month"
                                        value={selectedMonth}
                                        onChange={(e) => setSelectedMonth(e.target.value)}
                                        className="input w-auto"
                                    />
                                </div>
                            ) : (
                                <>
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
                                </>
                            )}
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => refreshData()}
                                className="btn-ghost"
                            >
                                Refresh
                            </button>
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
            <div className="grid grid-cols-3 gap-3">
                <div className="card p-4 bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 border-blue-200 dark:border-blue-800">
                    <p className="text-xs font-medium text-blue-600 dark:text-blue-400 uppercase tracking-wide">Days Worked</p>
                    <p className="text-2xl font-bold text-blue-900 dark:text-blue-100 mt-1">{monthlyTotals.daysWorked}</p>
                </div>
                <div className="card p-4 bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/20 border-green-200 dark:border-green-800">
                    <p className="text-xs font-medium text-green-600 dark:text-green-400 uppercase tracking-wide">Total Hours</p>
                    <p className="text-2xl font-bold text-green-900 dark:text-green-100 mt-1">{formatHours(monthlyTotals.totalHours)}</p>
                </div>
                <div className="card p-4 bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-800/50 dark:to-gray-700/50 border-gray-200 dark:border-gray-700">
                    <p className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">Break Time</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">{monthlyTotals.totalBreak}m</p>
                </div>
            </div>

            {/* Edit Modal */}
            {editingEntry && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={closeEditModal}>
                    <div className="bg-background rounded-lg shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
                        <div className="p-5">
                            <h3 className="text-lg font-semibold mb-1">Edit Attendance Time</h3>
                            <p className="text-sm text-muted-foreground mb-4">
                                {editingEntry.employee?.display_name || editingEntry.employee?.profiles?.full_name || 'Unknown'} &mdash; {formatShortDateWithWeekday(editingEntry.clock_in)}
                            </p>

                            {editError && (
                                <div className="mb-3 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-sm text-red-700 dark:text-red-300">
                                    {editError}
                                </div>
                            )}

                            <div className="space-y-3">
                                <div>
                                    <label className="block text-sm font-medium mb-1">Clock In</label>
                                    <input
                                        type="datetime-local"
                                        value={editClockIn}
                                        onChange={(e) => setEditClockIn(e.target.value)}
                                        className="input w-full"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1">Clock Out</label>
                                    <input
                                        type="datetime-local"
                                        value={editClockOut}
                                        onChange={(e) => setEditClockOut(e.target.value)}
                                        className="input w-full"
                                    />
                                    <p className="text-xs text-muted-foreground mt-1">Leave empty for in-progress entries</p>
                                </div>
                                {editPreviewHours !== null && (
                                    <div className="p-2 bg-muted rounded text-sm">
                                        Calculated hours: <span className="font-semibold">{formatHours(editPreviewHours)}</span>
                                        {editingEntry.break_minutes > 0 && (
                                            <span className="text-muted-foreground"> (after {editingEntry.break_minutes}m break)</span>
                                        )}
                                    </div>
                                )}
                                {editClockOut && editClockIn && editPreviewHours === null && (
                                    <div className="p-2 bg-red-50 dark:bg-red-900/20 rounded text-sm text-red-600 dark:text-red-400">
                                        Clock-out must be after clock-in
                                    </div>
                                )}
                            </div>

                            <div className="flex justify-end gap-2 mt-5">
                                <button
                                    onClick={closeEditModal}
                                    className="btn-ghost"
                                    disabled={savingEdit}
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSaveEdit}
                                    className="btn-primary"
                                    disabled={savingEdit || !editClockIn}
                                >
                                    {savingEdit ? 'Saving...' : 'Save'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Time Card Table */}
            <div className="card overflow-hidden" ref={tableRef}>
                <div className="overflow-x-auto">
                    {loading && !timeCardEntries.length ? (
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
                                    {employeeFilter === 'all' && (
                                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Employee</th>
                                    )}
                                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Date</th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Status</th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Type</th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Clock In</th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Clock Out</th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Break</th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Hours</th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider">Location</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {timeCardEntries.map((entry, index) => {
                                    const hours = entry.total_hours || 0
                                    const empName = entry.employee?.display_name || entry.employee?.profiles?.full_name || 'Unknown'

                                    return (
                                        <tr key={entry.id} className={`group ${index % 2 === 0 ? 'bg-background' : 'bg-muted/30'} hover:bg-muted/50 transition-colors`}>
                                            {employeeFilter === 'all' && (
                                                <td className="px-4 py-3 text-sm font-medium">{empName}</td>
                                            )}
                                            <td className="px-4 py-3 text-sm font-medium">
                                                {formatShortDateWithWeekday(entry.clock_in)}
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
                                            <td className="px-4 py-3 text-sm font-mono">
                                                <span className="inline-flex items-center gap-1">
                                                    {formatTime(entry.clock_in)}
                                                    <button
                                                        onClick={() => openEditModal(entry)}
                                                        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted print:hidden"
                                                        title="Edit times"
                                                    >
                                                        <svg className="w-3.5 h-3.5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                                        </svg>
                                                    </button>
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-sm font-mono">
                                                <span className="inline-flex items-center gap-1">
                                                    {entry.clock_out ? formatTime(entry.clock_out) : '-'}
                                                    <button
                                                        onClick={() => openEditModal(entry)}
                                                        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted print:hidden"
                                                        title="Edit times"
                                                    >
                                                        <svg className="w-3.5 h-3.5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                                        </svg>
                                                    </button>
                                                </span>
                                                {entry.actual_clock_out && (
                                                    <div className="text-xs text-muted-foreground font-sans">
                                                        Actual: {formatTime(entry.actual_clock_out)}
                                                        {entry.late_clock_out_minutes && (
                                                            <span className="ml-1 text-amber-600 dark:text-amber-400">
                                                                (+{entry.late_clock_out_minutes}m)
                                                            </span>
                                                        )}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-sm">{entry.break_minutes || 0}m</td>
                                            <td className="px-4 py-3 text-sm font-semibold">{formatHours(hours)}</td>
                                            <td className="px-4 py-3 text-sm">
                                                <div className="flex flex-col gap-0.5">
                                                    <div>
                                                        <span className="text-xs font-medium text-muted-foreground">In: </span>
                                                        {renderLocation(entry.clock_in_location_status, entry.clock_in_location_name)}
                                                    </div>
                                                    <div>
                                                        <span className="text-xs font-medium text-muted-foreground">Out: </span>
                                                        {renderLocation(entry.clock_out_location_status, entry.clock_out_location_name)}
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                            <tfoot>
                                <tr className="bg-primary/10 font-semibold">
                                    <td colSpan={employeeFilter === 'all' ? 6 : 5} className="px-4 py-3 text-sm">TOTALS</td>
                                    <td className="px-4 py-3 text-sm">{monthlyTotals.totalBreak}m</td>
                                    <td className="px-4 py-3 text-sm font-bold">{formatHours(monthlyTotals.totalHours)}</td>
                                    <td className="px-4 py-3 text-sm">-</td>
                                </tr>
                            </tfoot>
                        </table>
                    )}
                </div>
            </div>
        </div>
    )
}
