'use client'

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect } from 'react'
import { createUntypedClient } from '@/lib/supabase/client'
import { formatDate, formatDateOnly, formatDateTime, formatTime, getSignedStorageUrl, getTodayNY, getDateNY, getNYDayBoundary } from '@/lib/utils'

// Using 'any' type for Supabase joined data
type TaskCompletion = any

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

export default function ReportsPage() {
    const [selectedReport, setSelectedReport] = useState<string | null>(null)
    const [startDate, setStartDate] = useState(() => getDateNY(-7))
    const [endDate, setEndDate] = useState(() => getTodayNY())
    const [loading, setLoading] = useState(false)
    const [taskCompletions, setTaskCompletions] = useState<TaskCompletion[]>([])
    const [selectedCompletion, setSelectedCompletion] = useState<TaskCompletion | null>(null)
    const [signedPhotoUrl, setSignedPhotoUrl] = useState<string | null>(null)
    const [signedVideoUrl, setSignedVideoUrl] = useState<string | null>(null)
    const [attendanceLogs, setAttendanceLogs] = useState<any[]>([])
    const [events, setEvents] = useState<any[]>([])
    const [employeePerformance, setEmployeePerformance] = useState<any[]>([])
    const [showExportMenu, setShowExportMenu] = useState(false)

    const reportTypes = [
        {
            id: 'attendance',
            title: 'Attendance Report',
            description: 'View attendance patterns, hours worked, and punctuality',
            icon: '⏰',
        },
        {
            id: 'tasks',
            title: 'Task Completion Report',
            description: 'Track task completion rates and performance',
            icon: '✅',
        },
        {
            id: 'events',
            title: 'Events Report',
            description: 'Review events, staffing, and checklist completion',
            icon: '🎉',
        },
        {
            id: 'employee',
            title: 'Employee Performance',
            description: 'Individual employee metrics and statistics',
            icon: '📊',
        },
    ]

    async function generateTaskReport() {
        setLoading(true)
        try {
            const supabase = createUntypedClient()
            const { data, error } = await supabase
                .from('task_instances')
                .select(`
                    id,
                    scheduled_date,
                    status,
                    completed_at,
                    notes,
                    photo_url,
                    video_url,
                    tasks (
                        title,
                        description,
                        location
                    ),
                    employees (
                        id,
                        display_name
                    )
                `)
                .gte('scheduled_date', startDate)
                .lte('scheduled_date', endDate)
                .order('scheduled_date', { ascending: false })
                .limit(100)

            if (error) throw error
            setTaskCompletions(data || [])
        } catch (err) {
            console.error('Error generating report:', err)
            alert('Failed to generate report')
        } finally {
            setLoading(false)
        }
    }

    async function generateAttendanceReport() {
        setLoading(true)
        try {
            const supabase = createUntypedClient()
            // Use NY timezone day boundaries for correct date range filtering
            const startOfDay = new Date(getNYDayBoundary(startDate, 'start'))
            const endOfDay = new Date(getNYDayBoundary(endDate, 'end'))

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
            setAttendanceLogs(data || [])
        } catch (err) {
            console.error('Error generating attendance report:', err)
            alert('Failed to generate attendance report')
        } finally {
            setLoading(false)
        }
    }

    async function generateEventsReport() {
        setLoading(true)
        try {
            const supabase = createUntypedClient()
            // Use NY timezone day boundaries for correct date range filtering
            const startOfDay = new Date(getNYDayBoundary(startDate, 'start'))
            const endOfDay = new Date(getNYDayBoundary(endDate, 'end'))

            const { data, error } = await supabase
                .from('events')
                .select(`
                    *,
                    event_staff_assignments (
                        id,
                        role,
                        employees (
                            id,
                            display_name,
                            position
                        )
                    ),
                    event_checklists (
                        id,
                        task_title,
                        status,
                        completed_at
                    )
                `)
                .gte('start_time', startOfDay.toISOString())
                .lte('start_time', endOfDay.toISOString())
                .order('start_time', { ascending: false })

            if (error) throw error
            setEvents(data || [])
        } catch (err) {
            console.error('Error generating events report:', err)
            alert('Failed to generate events report')
        } finally {
            setLoading(false)
        }
    }

    async function generateEmployeeReport() {
        setLoading(true)
        try {
            const supabase = createUntypedClient()
            // Use NY timezone day boundaries for correct date range filtering
            const startOfDay = new Date(getNYDayBoundary(startDate, 'start'))
            const endOfDay = new Date(getNYDayBoundary(endDate, 'end'))

            // Get all employees
            const { data: employees, error: empError } = await supabase
                .from('employees')
                .select('id, display_name, position')
                .eq('is_active', true)

            if (empError) throw empError

            // Get attendance data
            const { data: attendance, error: attError } = await supabase
                .from('attendance_logs')
                .select('*')
                .gte('clock_in', startOfDay.toISOString())
                .lte('clock_in', endOfDay.toISOString())

            if (attError) throw attError

            // Get task completion data
            const { data: tasks, error: taskError } = await supabase
                .from('task_instances')
                .select('*')
                .gte('scheduled_date', startDate)
                .lte('scheduled_date', endDate)

            if (taskError) throw taskError

            // Aggregate data per employee
            const performance = (employees || []).map((emp: any) => {
                const empAttendance = (attendance || []).filter((a: any) => a.employee_id === emp.id)
                const empTasks = (tasks || []).filter((t: any) => t.employee_id === emp.id)

                const totalShifts = empAttendance.length
                const completedShifts = empAttendance.filter((a: any) => a.clock_out).length
                const totalHours = empAttendance
                    .filter((a: any) => a.total_hours)
                    .reduce((sum: number, a: any) => sum + (a.total_hours || 0), 0)
                const lateArrivals = empAttendance.filter((a: any) => a.late_flag).length

                const totalTasks = empTasks.length
                const completedTasks = empTasks.filter((t: any) => t.status === 'completed').length
                const taskCompletionRate = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0

                return {
                    ...emp,
                    totalShifts,
                    completedShifts,
                    totalHours: totalHours.toFixed(2),
                    lateArrivals,
                    totalTasks,
                    completedTasks,
                    taskCompletionRate: taskCompletionRate.toFixed(1),
                }
            })

            setEmployeePerformance(performance)
        } catch (err) {
            console.error('Error generating employee report:', err)
            alert('Failed to generate employee performance report')
        } finally {
            setLoading(false)
        }
    }

    function handleGenerateReport() {
        if (selectedReport === 'tasks') {
            generateTaskReport()
        } else if (selectedReport === 'attendance') {
            generateAttendanceReport()
        } else if (selectedReport === 'events') {
            generateEventsReport()
        } else if (selectedReport === 'employee') {
            generateEmployeeReport()
        }
    }

    // Export functions
    function exportToPDF() {
        setShowExportMenu(false)
        const printWindow = window.open('', '_blank')
        if (!printWindow) {
            alert('Please allow popups to export PDF')
            return
        }

        const reportTitle = reportTypes.find(r => r.id === selectedReport)?.title || 'Report'
        const dateRange = `${formatDateOnly(startDate)} - ${formatDateOnly(endDate)}`

        let tableContent = ''
        let summaryContent = ''

        if (selectedReport === 'attendance') {
            summaryContent = `
                <div class="summary">
                    <div class="summary-item"><div class="summary-label">Completed Shifts</div><div class="summary-value">${completedShifts}</div></div>
                    <div class="summary-item"><div class="summary-label">Currently In</div><div class="summary-value">${currentlyClockedIn}</div></div>
                    <div class="summary-item"><div class="summary-label">Late Arrivals</div><div class="summary-value">${lateArrivals}</div></div>
                    <div class="summary-item"><div class="summary-label">Total Hours</div><div class="summary-value">${totalHours.toFixed(1)}h</div></div>
                </div>
            `
            tableContent = `
                <table>
                    <thead><tr><th>Employee</th><th>Position</th><th>Clock In</th><th>Clock Out</th><th>Hours</th><th>Status</th></tr></thead>
                    <tbody>
                        ${attendanceLogs.map(log => `
                            <tr>
                                <td>${escapeHtml(log.employees?.display_name || 'Unknown')}</td>
                                <td>${escapeHtml(log.employees?.position || '-')}</td>
                                <td>${formatDateTime(log.clock_in)}</td>
                                <td>${log.clock_out ? formatDateTime(log.clock_out) : 'In Progress'}</td>
                                <td>${log.total_hours ? log.total_hours.toFixed(2) + 'h' : '-'}</td>
                                <td>${log.late_flag ? 'Late' : ''}${log.early_checkout_flag ? ' Early' : ''}${log.late_clock_out_minutes ? ` Late Out (${log.late_clock_out_minutes}m)` : ''}${!log.late_flag && !log.early_checkout_flag && !log.late_clock_out_minutes ? 'OK' : ''}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `
        } else if (selectedReport === 'tasks') {
            summaryContent = `
                <div class="summary">
                    <div class="summary-item"><div class="summary-label">Completed</div><div class="summary-value">${completedCount}</div></div>
                    <div class="summary-item"><div class="summary-label">Pending</div><div class="summary-value">${pendingCount}</div></div>
                    <div class="summary-item"><div class="summary-label">Overdue</div><div class="summary-value">${overdueCount}</div></div>
                </div>
            `
            tableContent = `
                <table>
                    <thead><tr><th>Task</th><th>Employee</th><th>Date</th><th>Status</th><th>Location</th></tr></thead>
                    <tbody>
                        ${taskCompletions.map(task => `
                            <tr>
                                <td>${escapeHtml(task.tasks?.title || 'Unknown')}</td>
                                <td>${escapeHtml(task.employees?.display_name || 'Unassigned')}</td>
                                <td>${formatDateOnly(task.scheduled_date)}</td>
                                <td>${escapeHtml(task.status)}</td>
                                <td>${escapeHtml(task.tasks?.location || '-')}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `
        } else if (selectedReport === 'events') {
            const totalEvents = events.length
            const fullyCompleted = events.filter((e: any) => {
                const checklists = e.event_checklists || []
                return checklists.length > 0 && checklists.every((c: any) => c.status === 'completed')
            }).length
            const totalStaff = events.reduce((sum: number, e: any) => sum + (e.event_staff_assignments?.length || 0), 0)

            summaryContent = `
                <div class="summary">
                    <div class="summary-item"><div class="summary-label">Total Events</div><div class="summary-value">${totalEvents}</div></div>
                    <div class="summary-item"><div class="summary-label">Fully Completed</div><div class="summary-value">${fullyCompleted}</div></div>
                    <div class="summary-item"><div class="summary-label">Staff Assignments</div><div class="summary-value">${totalStaff}</div></div>
                </div>
            `
            tableContent = `
                <table>
                    <thead><tr><th>Event</th><th>Date & Time</th><th>Room</th><th>Staff</th><th>Checklist</th></tr></thead>
                    <tbody>
                        ${events.map((event: any) => {
                            const checklists = event.event_checklists || []
                            const completed = checklists.filter((c: any) => c.status === 'completed').length
                            return `
                                <tr>
                                    <td>${escapeHtml(event.title || 'Untitled')}</td>
                                    <td>${formatDateTime(event.start_time)}</td>
                                    <td>${escapeHtml(event.room || '-')}</td>
                                    <td>${event.event_staff_assignments?.length || 0} staff</td>
                                    <td>${completed}/${checklists.length}</td>
                                </tr>
                            `
                        }).join('')}
                    </tbody>
                </table>
            `
        } else if (selectedReport === 'employee') {
            const totalEmployees = employeePerformance.length
            const totalTasksCompleted = employeePerformance.reduce((sum: number, emp: any) => sum + parseInt(emp.completedTasks || 0), 0)
            const totalHoursWorked = employeePerformance.reduce((sum: number, emp: any) => sum + parseFloat(emp.totalHours || 0), 0)

            summaryContent = `
                <div class="summary">
                    <div class="summary-item"><div class="summary-label">Total Employees</div><div class="summary-value">${totalEmployees}</div></div>
                    <div class="summary-item"><div class="summary-label">Tasks Completed</div><div class="summary-value">${totalTasksCompleted}</div></div>
                    <div class="summary-item"><div class="summary-label">Total Hours</div><div class="summary-value">${totalHoursWorked.toFixed(1)}h</div></div>
                </div>
            `
            tableContent = `
                <table>
                    <thead><tr><th>Employee</th><th>Position</th><th>Shifts</th><th>Hours</th><th>Tasks</th><th>Completion Rate</th><th>Late</th></tr></thead>
                    <tbody>
                        ${employeePerformance.map((emp: any) => `
                            <tr>
                                <td>${escapeHtml(emp.display_name || 'Unknown')}</td>
                                <td>${escapeHtml(emp.position || '-')}</td>
                                <td>${emp.completedShifts}/${emp.totalShifts}</td>
                                <td>${emp.totalHours}h</td>
                                <td>${emp.completedTasks}/${emp.totalTasks}</td>
                                <td>${emp.taskCompletionRate}%</td>
                                <td>${emp.lateArrivals || 0}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `
        }

        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>${reportTitle} - ${dateRange}</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 20px; }
                    h1 { color: #4F46E5; margin-bottom: 5px; font-size: 24px; }
                    .meta { color: #666; margin-bottom: 20px; font-size: 14px; }
                    .summary { display: flex; gap: 30px; margin-bottom: 20px; padding: 15px; background: #f5f5f5; border-radius: 8px; flex-wrap: wrap; }
                    .summary-item { text-align: center; min-width: 100px; }
                    .summary-label { font-size: 12px; color: #666; }
                    .summary-value { font-size: 24px; font-weight: bold; color: #333; }
                    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                    th, td { border: 1px solid #ddd; padding: 10px; text-align: left; font-size: 12px; }
                    th { background-color: #4F46E5; color: white; }
                    tr:nth-child(even) { background-color: #f9f9f9; }
                    .footer { margin-top: 30px; text-align: center; color: #999; font-size: 12px; }
                    @media print { body { padding: 0; } }
                </style>
            </head>
            <body>
                <h1>${reportTitle}</h1>
                <p class="meta">Date Range: ${dateRange} | Generated: ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}</p>
                ${summaryContent}
                ${tableContent}
                <div class="footer">PlayFunia Employee Management System</div>
                <script>window.onload = function() { window.print(); }</script>
            </body>
            </html>
        `)
        printWindow.document.close()
    }

    function exportToCSV() {
        setShowExportMenu(false)
        let headers: string[] = []
        let rows: string[][] = []
        let filename = ''

        if (selectedReport === 'attendance') {
            filename = `attendance_report_${startDate}_to_${endDate}.csv`
            headers = ['Employee', 'Position', 'Clock In', 'Clock Out', 'Actual Clock Out', 'Hours', 'Late', 'Early Out', 'Late Out (min)']
            rows = attendanceLogs.map(log => [
                log.employees?.display_name || 'Unknown',
                log.employees?.position || '',
                formatDateTime(log.clock_in),
                log.clock_out ? formatDateTime(log.clock_out) : '',
                log.actual_clock_out ? formatDateTime(log.actual_clock_out) : '',
                log.total_hours ? log.total_hours.toFixed(2) : '',
                log.late_flag ? 'Yes' : 'No',
                log.early_checkout_flag ? 'Yes' : 'No',
                log.late_clock_out_minutes ? log.late_clock_out_minutes.toString() : ''
            ])
            rows.push([])
            rows.push(['Summary'])
            rows.push(['Completed Shifts', completedShifts.toString()])
            rows.push(['Currently In', currentlyClockedIn.toString()])
            rows.push(['Late Arrivals', lateArrivals.toString()])
            rows.push(['Total Hours', totalHours.toFixed(2)])
        } else if (selectedReport === 'tasks') {
            filename = `task_report_${startDate}_to_${endDate}.csv`
            headers = ['Task', 'Employee', 'Date', 'Status', 'Location', 'Has Notes', 'Has Photo', 'Has Video']
            rows = taskCompletions.map(task => [
                task.tasks?.title || 'Unknown',
                task.employees?.display_name || 'Unassigned',
                formatDateOnly(task.scheduled_date),
                task.status,
                task.tasks?.location || '',
                task.notes ? 'Yes' : 'No',
                task.photo_url ? 'Yes' : 'No',
                task.video_url ? 'Yes' : 'No'
            ])
            rows.push([])
            rows.push(['Summary'])
            rows.push(['Completed', completedCount.toString()])
            rows.push(['Pending', pendingCount.toString()])
            rows.push(['Overdue', overdueCount.toString()])
        } else if (selectedReport === 'events') {
            filename = `events_report_${startDate}_to_${endDate}.csv`
            headers = ['Event', 'Date', 'Start Time', 'End Time', 'Room', 'Staff Count', 'Checklist Completed', 'Checklist Total']
            rows = events.map((event: any) => {
                const checklists = event.event_checklists || []
                const completed = checklists.filter((c: any) => c.status === 'completed').length
                return [
                    event.title || 'Untitled',
                    formatDate(event.start_time),
                    formatTime(event.start_time),
                    event.end_time ? formatTime(event.end_time) : '',
                    event.room || '',
                    (event.event_staff_assignments?.length || 0).toString(),
                    completed.toString(),
                    checklists.length.toString()
                ]
            })
            rows.push([])
            rows.push(['Summary'])
            rows.push(['Total Events', events.length.toString()])
        } else if (selectedReport === 'employee') {
            filename = `employee_performance_${startDate}_to_${endDate}.csv`
            headers = ['Employee', 'Position', 'Completed Shifts', 'Total Shifts', 'Total Hours', 'Completed Tasks', 'Total Tasks', 'Completion Rate', 'Late Arrivals']
            rows = employeePerformance.map((emp: any) => [
                emp.display_name || 'Unknown',
                emp.position || '',
                emp.completedShifts.toString(),
                emp.totalShifts.toString(),
                emp.totalHours,
                emp.completedTasks.toString(),
                emp.totalTasks.toString(),
                emp.taskCompletionRate + '%',
                emp.lateArrivals.toString()
            ])
        }

        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(','))
        ].join('\n')

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
        const link = document.createElement('a')
        const url = URL.createObjectURL(blob)
        link.setAttribute('href', url)
        link.setAttribute('download', filename)
        link.style.visibility = 'hidden'
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
    }

    // Check if current report has data
    function hasReportData() {
        if (selectedReport === 'attendance') return attendanceLogs.length > 0
        if (selectedReport === 'tasks') return taskCompletions.length > 0
        if (selectedReport === 'events') return events.length > 0
        if (selectedReport === 'employee') return employeePerformance.length > 0
        return false
    }

    // Generate signed URLs when viewing a task completion
    useEffect(() => {
        async function loadSignedUrls() {
            if (selectedCompletion) {
                const photoUrl = await getSignedStorageUrl(selectedCompletion.photo_url)
                const videoUrl = await getSignedStorageUrl(selectedCompletion.video_url)
                setSignedPhotoUrl(photoUrl)
                setSignedVideoUrl(videoUrl)
            } else {
                setSignedPhotoUrl(null)
                setSignedVideoUrl(null)
            }
        }
        loadSignedUrls()
    }, [selectedCompletion])

    const completedCount = taskCompletions.filter(t => t.status === 'completed').length
    const pendingCount = taskCompletions.filter(t => t.status === 'pending').length
    const overdueCount = taskCompletions.filter(t => t.status === 'overdue').length

    // Attendance report stats
    const currentlyClockedIn = attendanceLogs.filter((log) => !log.clock_out).length
    const completedShifts = attendanceLogs.filter((log) => log.clock_out).length
    const lateArrivals = attendanceLogs.filter((log) => log.late_flag).length
    const totalHours = attendanceLogs
        .filter((log) => log.total_hours)
        .reduce((sum, log) => sum + (log.total_hours || 0), 0)

    return (
        <div className="space-y-4 sm:space-y-6">
            <div>
                <h1 className="text-2xl sm:text-3xl font-bold">Reports</h1>
                <p className="text-muted-foreground mt-1 text-sm sm:text-base">
                    Generate and view detailed reports
                </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                {reportTypes.map((report) => (
                    <button
                        key={report.id}
                        onClick={() => setSelectedReport(report.id)}
                        className={`card p-4 sm:p-6 text-left hover:shadow-md transition-all ${selectedReport === report.id ? 'ring-2 ring-primary' : ''
                            }`}
                    >
                        <div className="flex items-start gap-3 sm:gap-4">
                            <span className="text-2xl sm:text-3xl flex-shrink-0">{report.icon}</span>
                            <div className="min-w-0">
                                <h3 className="font-semibold text-sm sm:text-base">{report.title}</h3>
                                <p className="text-xs sm:text-sm text-muted-foreground mt-1 line-clamp-2">
                                    {report.description}
                                </p>
                            </div>
                        </div>
                    </button>
                ))}
            </div>

            {selectedReport && (
                <div className="card">
                    <div className="card-header">
                        <h2 className="card-title text-base sm:text-lg">
                            {reportTypes.find((r) => r.id === selectedReport)?.title}
                        </h2>
                    </div>
                    <div className="card-content">
                        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 mb-4 sm:mb-6">
                            <div className="flex-1">
                                <label className="label mb-1.5 block text-sm">Start Date</label>
                                <input
                                    type="date"
                                    className="input"
                                    value={startDate}
                                    onChange={(e) => setStartDate(e.target.value)}
                                />
                            </div>
                            <div className="flex-1">
                                <label className="label mb-1.5 block text-sm">End Date</label>
                                <input
                                    type="date"
                                    className="input"
                                    value={endDate}
                                    onChange={(e) => setEndDate(e.target.value)}
                                />
                            </div>
                            <div className="flex items-end gap-2">
                                <button
                                    className="btn-primary"
                                    onClick={handleGenerateReport}
                                    disabled={loading}
                                >
                                    {loading ? 'Loading...' : 'Generate Report'}
                                </button>

                                {/* Export Dropdown */}
                                {hasReportData() && (
                                    <div className="relative">
                                        <button
                                            className="btn-outline inline-flex items-center gap-1"
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
                                                        onClick={exportToCSV}
                                                    >
                                                        <svg className="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 24 24">
                                                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/>
                                                            <path d="M8 12h2v6H8zm4-2h2v8h-2zm-2 4h2v4h-2z"/>
                                                        </svg>
                                                        Export as CSV
                                                    </button>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        {selectedReport === 'tasks' && taskCompletions.length > 0 && (
                            <>
                                {/* Summary Stats */}
                                <div className="grid grid-cols-3 gap-4 mb-6">
                                    <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg text-center">
                                        <p className="text-2xl font-bold text-green-600">{completedCount}</p>
                                        <p className="text-sm text-green-700 dark:text-green-400">Completed</p>
                                    </div>
                                    <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg text-center">
                                        <p className="text-2xl font-bold text-yellow-600">{pendingCount}</p>
                                        <p className="text-sm text-yellow-700 dark:text-yellow-400">Pending</p>
                                    </div>
                                    <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg text-center">
                                        <p className="text-2xl font-bold text-red-600">{overdueCount}</p>
                                        <p className="text-sm text-red-700 dark:text-red-400">Overdue</p>
                                    </div>
                                </div>

                                {/* Task List */}
                                <div className="border rounded-lg overflow-hidden">
                                    <table className="w-full">
                                        <thead className="bg-muted">
                                            <tr>
                                                <th className="px-4 py-3 text-left text-sm font-medium">Task</th>
                                                <th className="px-4 py-3 text-left text-sm font-medium">Employee</th>
                                                <th className="px-4 py-3 text-left text-sm font-medium">Date</th>
                                                <th className="px-4 py-3 text-left text-sm font-medium">Status</th>
                                                <th className="px-4 py-3 text-left text-sm font-medium">Attachments</th>
                                                <th className="px-4 py-3 text-left text-sm font-medium">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y">
                                            {taskCompletions.map((task) => (
                                                <tr key={task.id} className="hover:bg-muted/50">
                                                    <td className="px-4 py-3">
                                                        <p className="font-medium">{task.tasks?.title || 'Unknown'}</p>
                                                        {task.tasks?.location && (
                                                            <p className="text-xs text-muted-foreground">📍 {task.tasks.location}</p>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3 text-sm">
                                                        {task.employees?.display_name || 'Unassigned'}
                                                    </td>
                                                    <td className="px-4 py-3 text-sm">
                                                        {formatDateOnly(task.scheduled_date)}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <span className={`badge text-xs ${task.status === 'completed' ? 'badge-success' :
                                                            task.status === 'overdue' ? 'badge-destructive' :
                                                                'badge-warning'
                                                            }`}>
                                                            {task.status}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <div className="flex gap-1">
                                                            {task.notes && <span title="Has notes">📝</span>}
                                                            {task.photo_url && <span title="Has photo">📷</span>}
                                                            {task.video_url && <span title="Has video">🎥</span>}
                                                            {!task.notes && !task.photo_url && !task.video_url && (
                                                                <span className="text-muted-foreground text-xs">-</span>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <button
                                                            className="btn-ghost btn-sm"
                                                            onClick={() => setSelectedCompletion(task)}
                                                        >
                                                            View
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </>
                        )}

                        {selectedReport === 'tasks' && taskCompletions.length === 0 && !loading && (
                            <div className="p-8 text-center border-2 border-dashed rounded-lg">
                                <p className="text-muted-foreground">
                                    Select date range and click &quot;Generate Report&quot; to view data
                                </p>
                            </div>
                        )}

                        {selectedReport === 'attendance' && attendanceLogs.length > 0 && (
                            <>
                                {/* Summary Stats */}
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                                    <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg text-center">
                                        <p className="text-2xl font-bold text-green-600">{completedShifts}</p>
                                        <p className="text-sm text-green-700 dark:text-green-400">Completed Shifts</p>
                                    </div>
                                    <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-center">
                                        <p className="text-2xl font-bold text-blue-600">{currentlyClockedIn}</p>
                                        <p className="text-sm text-blue-700 dark:text-blue-400">Currently In</p>
                                    </div>
                                    <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg text-center">
                                        <p className="text-2xl font-bold text-yellow-600">{lateArrivals}</p>
                                        <p className="text-sm text-yellow-700 dark:text-yellow-400">Late Arrivals</p>
                                    </div>
                                    <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg text-center">
                                        <p className="text-2xl font-bold text-purple-600">{totalHours.toFixed(1)}</p>
                                        <p className="text-sm text-purple-700 dark:text-purple-400">Total Hours</p>
                                    </div>
                                </div>

                                {/* Attendance List */}
                                <div className="border rounded-lg overflow-hidden">
                                    <table className="w-full">
                                        <thead className="bg-muted">
                                            <tr>
                                                <th className="px-4 py-3 text-left text-sm font-medium">Employee</th>
                                                <th className="px-4 py-3 text-left text-sm font-medium">Position</th>
                                                <th className="px-4 py-3 text-left text-sm font-medium">Clock In</th>
                                                <th className="px-4 py-3 text-left text-sm font-medium">Clock Out</th>
                                                <th className="px-4 py-3 text-left text-sm font-medium">Hours</th>
                                                <th className="px-4 py-3 text-left text-sm font-medium">Status</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y">
                                            {attendanceLogs.map((log) => (
                                                <tr key={log.id} className="hover:bg-muted/50">
                                                    <td className="px-4 py-3">
                                                        <p className="font-medium">{log.employees?.display_name || 'Unknown'}</p>
                                                    </td>
                                                    <td className="px-4 py-3 text-sm text-muted-foreground">
                                                        {log.employees?.position || '-'}
                                                    </td>
                                                    <td className="px-4 py-3 text-sm">
                                                        {formatDateTime(log.clock_in)}
                                                    </td>
                                                    <td className="px-4 py-3 text-sm">
                                                        {log.clock_out ? formatDateTime(log.clock_out) : (
                                                            <span className="text-green-600 font-medium">In Progress</span>
                                                        )}
                                                        {log.actual_clock_out && (
                                                            <div className="text-xs text-muted-foreground">
                                                                Actual: {formatDateTime(log.actual_clock_out)}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3 text-sm">
                                                        {log.total_hours ? `${log.total_hours.toFixed(2)}h` : '-'}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <div className="flex gap-1 flex-wrap">
                                                            {log.late_flag && (
                                                                <span className="badge badge-warning text-xs">Late</span>
                                                            )}
                                                            {log.early_checkout_flag && (
                                                                <span className="badge badge-warning text-xs">Early</span>
                                                            )}
                                                            {log.late_clock_out_minutes && (
                                                                <span className="badge badge-warning text-xs">Late Out ({log.late_clock_out_minutes}m)</span>
                                                            )}
                                                            {!log.clock_out && (
                                                                <span className="badge badge-success text-xs">Active</span>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </>
                        )}

                        {selectedReport === 'attendance' && attendanceLogs.length === 0 && !loading && (
                            <div className="p-8 text-center border-2 border-dashed rounded-lg">
                                <p className="text-muted-foreground">
                                    Select date range and click &quot;Generate Report&quot; to view data
                                </p>
                            </div>
                        )}

                        {selectedReport === 'events' && events.length > 0 && (
                            <>
                                {/* Summary Stats */}
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                                    <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-center">
                                        <p className="text-2xl font-bold text-blue-600">{events.length}</p>
                                        <p className="text-sm text-blue-700 dark:text-blue-400">Total Events</p>
                                    </div>
                                    <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg text-center">
                                        <p className="text-2xl font-bold text-green-600">
                                            {events.filter((e: any) => {
                                                const checklists = e.event_checklists || []
                                                return checklists.length > 0 && checklists.every((c: any) => c.status === 'completed')
                                            }).length}
                                        </p>
                                        <p className="text-sm text-green-700 dark:text-green-400">Fully Completed</p>
                                    </div>
                                    <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg text-center">
                                        <p className="text-2xl font-bold text-purple-600">
                                            {events.reduce((sum: number, e: any) => {
                                                return sum + (e.event_staff_assignments?.length || 0)
                                            }, 0)}
                                        </p>
                                        <p className="text-sm text-purple-700 dark:text-purple-400">Staff Assignments</p>
                                    </div>
                                    <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg text-center">
                                        <p className="text-2xl font-bold text-yellow-600">
                                            {events.reduce((sum: number, e: any) => {
                                                const checklists = e.event_checklists || []
                                                return sum + checklists.filter((c: any) => c.status === 'completed').length
                                            }, 0)}
                                        </p>
                                        <p className="text-sm text-yellow-700 dark:text-yellow-400">Checklist Items</p>
                                    </div>
                                </div>

                                {/* Events List */}
                                <div className="border rounded-lg overflow-hidden">
                                    <table className="w-full">
                                        <thead className="bg-muted">
                                            <tr>
                                                <th className="px-4 py-3 text-left text-sm font-medium">Event</th>
                                                <th className="px-4 py-3 text-left text-sm font-medium">Date & Time</th>
                                                <th className="px-4 py-3 text-left text-sm font-medium">Room</th>
                                                <th className="px-4 py-3 text-left text-sm font-medium">Staff</th>
                                                <th className="px-4 py-3 text-left text-sm font-medium">Checklist</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y">
                                            {events.map((event: any) => {
                                                const checklists = event.event_checklists || []
                                                const completedChecklists = checklists.filter((c: any) => c.status === 'completed').length
                                                const totalChecklists = checklists.length
                                                const staffCount = event.event_staff_assignments?.length || 0

                                                return (
                                                    <tr key={event.id} className="hover:bg-muted/50">
                                                        <td className="px-4 py-3">
                                                            <p className="font-medium">{event.title || 'Untitled Event'}</p>
                                                            {event.description && (
                                                                <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{event.description}</p>
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-3 text-sm">
                                                            <p>{formatDate(event.start_time)}</p>
                                                            <p className="text-xs text-muted-foreground">
                                                                {formatTime(event.start_time)}
                                                                {event.end_time && ` - ${formatTime(event.end_time)}`}
                                                            </p>
                                                        </td>
                                                        <td className="px-4 py-3 text-sm">
                                                            {event.room || '-'}
                                                        </td>
                                                        <td className="px-4 py-3 text-sm">
                                                            <div className="flex flex-col gap-1">
                                                                <span className="font-medium">{staffCount} staff</span>
                                                                {event.event_staff_assignments && event.event_staff_assignments.length > 0 && (
                                                                    <div className="text-xs text-muted-foreground">
                                                                        {event.event_staff_assignments.slice(0, 2).map((assignment: any, idx: number) => (
                                                                            <div key={idx}>
                                                                                {assignment.employees?.display_name || 'Unknown'} ({assignment.role})
                                                                            </div>
                                                                        ))}
                                                                        {staffCount > 2 && <div>+{staffCount - 2} more</div>}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            {totalChecklists > 0 ? (
                                                                <div className="flex items-center gap-2">
                                                                    <span className="text-sm font-medium">
                                                                        {completedChecklists}/{totalChecklists}
                                                                    </span>
                                                                    <span className={`badge text-xs ${completedChecklists === totalChecklists ? 'badge-success' : 'badge-warning'
                                                                        }`}>
                                                                        {completedChecklists === totalChecklists ? 'Complete' : 'In Progress'}
                                                                    </span>
                                                                </div>
                                                            ) : (
                                                                <span className="text-sm text-muted-foreground">No checklist</span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                )
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </>
                        )}

                        {selectedReport === 'events' && events.length === 0 && !loading && (
                            <div className="p-8 text-center border-2 border-dashed rounded-lg">
                                <p className="text-muted-foreground">
                                    Select date range and click &quot;Generate Report&quot; to view data
                                </p>
                            </div>
                        )}

                        {selectedReport === 'employee' && employeePerformance.length > 0 && (
                            <>
                                {/* Summary Stats */}
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                                    <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-center">
                                        <p className="text-2xl font-bold text-blue-600">{employeePerformance.length}</p>
                                        <p className="text-sm text-blue-700 dark:text-blue-400">Total Employees</p>
                                    </div>
                                    <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg text-center">
                                        <p className="text-2xl font-bold text-green-600">
                                            {employeePerformance.reduce((sum: number, emp: any) => sum + parseInt(emp.completedTasks || 0), 0)}
                                        </p>
                                        <p className="text-sm text-green-700 dark:text-green-400">Tasks Completed</p>
                                    </div>
                                    <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg text-center">
                                        <p className="text-2xl font-bold text-purple-600">
                                            {employeePerformance.reduce((sum: number, emp: any) => sum + parseFloat(emp.totalHours || 0), 0).toFixed(1)}
                                        </p>
                                        <p className="text-sm text-purple-700 dark:text-purple-400">Total Hours</p>
                                    </div>
                                    <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg text-center">
                                        <p className="text-2xl font-bold text-yellow-600">
                                            {employeePerformance.reduce((sum: number, emp: any) => sum + parseInt(emp.completedShifts || 0), 0)}
                                        </p>
                                        <p className="text-sm text-yellow-700 dark:text-yellow-400">Shifts Completed</p>
                                    </div>
                                </div>

                                {/* Employee Performance List */}
                                <div className="border rounded-lg overflow-hidden">
                                    <table className="w-full">
                                        <thead className="bg-muted">
                                            <tr>
                                                <th className="px-4 py-3 text-left text-sm font-medium">Employee</th>
                                                <th className="px-4 py-3 text-left text-sm font-medium">Position</th>
                                                <th className="px-4 py-3 text-left text-sm font-medium">Shifts</th>
                                                <th className="px-4 py-3 text-left text-sm font-medium">Hours</th>
                                                <th className="px-4 py-3 text-left text-sm font-medium">Tasks</th>
                                                <th className="px-4 py-3 text-left text-sm font-medium">Completion Rate</th>
                                                <th className="px-4 py-3 text-left text-sm font-medium">Late Arrivals</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y">
                                            {employeePerformance.map((emp: any) => (
                                                <tr key={emp.id} className="hover:bg-muted/50">
                                                    <td className="px-4 py-3">
                                                        <p className="font-medium">{emp.display_name || 'Unknown'}</p>
                                                    </td>
                                                    <td className="px-4 py-3 text-sm text-muted-foreground">
                                                        {emp.position || '-'}
                                                    </td>
                                                    <td className="px-4 py-3 text-sm">
                                                        <div className="flex flex-col">
                                                            <span className="font-medium">{emp.completedShifts}/{emp.totalShifts}</span>
                                                            <span className="text-xs text-muted-foreground">completed</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3 text-sm">
                                                        <span className="font-medium">{emp.totalHours}h</span>
                                                    </td>
                                                    <td className="px-4 py-3 text-sm">
                                                        <div className="flex flex-col">
                                                            <span className="font-medium">{emp.completedTasks}/{emp.totalTasks}</span>
                                                            <span className="text-xs text-muted-foreground">completed</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-medium">{emp.taskCompletionRate}%</span>
                                                            <div className="flex-1 bg-muted rounded-full h-2 max-w-20">
                                                                <div
                                                                    className="bg-primary h-2 rounded-full"
                                                                    style={{ width: `${Math.min(100, parseFloat(emp.taskCompletionRate))}%` }}
                                                                />
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        {emp.lateArrivals > 0 ? (
                                                            <span className="badge badge-warning text-xs">{emp.lateArrivals}</span>
                                                        ) : (
                                                            <span className="text-sm text-muted-foreground">-</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </>
                        )}

                        {selectedReport === 'employee' && employeePerformance.length === 0 && !loading && (
                            <div className="p-8 text-center border-2 border-dashed rounded-lg">
                                <p className="text-muted-foreground">
                                    Select date range and click &quot;Generate Report&quot; to view data
                                </p>
                            </div>
                        )}

                        {selectedReport !== 'tasks' && selectedReport !== 'attendance' && selectedReport !== 'events' && selectedReport !== 'employee' && (
                            <div className="p-8 text-center border-2 border-dashed rounded-lg">
                                <p className="text-muted-foreground">
                                    This report type is coming soon
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Task Detail Modal */}
            {selectedCompletion && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-card rounded-lg shadow-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                        <div className="p-6">
                            <div className="flex items-start justify-between mb-4">
                                <div>
                                    <h2 className="text-xl font-bold">{selectedCompletion.tasks?.title}</h2>
                                    <p className="text-muted-foreground">
                                        {selectedCompletion.employees?.display_name || 'Unassigned'} • {formatDateOnly(selectedCompletion.scheduled_date)}
                                    </p>
                                </div>
                                <button
                                    onClick={() => setSelectedCompletion(null)}
                                    className="text-muted-foreground hover:text-foreground text-xl"
                                >
                                    ✕
                                </button>
                            </div>

                            <div className="space-y-4">
                                {/* Status */}
                                <div className="flex items-center gap-2">
                                    <span className="font-medium">Status:</span>
                                    <span className={`badge ${selectedCompletion.status === 'completed' ? 'badge-success' :
                                        selectedCompletion.status === 'overdue' ? 'badge-destructive' :
                                            'badge-warning'
                                        }`}>
                                        {selectedCompletion.status}
                                    </span>
                                    {selectedCompletion.completed_at && (
                                        <span className="text-sm text-muted-foreground">
                                            (Completed {formatDateTime(selectedCompletion.completed_at)})
                                        </span>
                                    )}
                                </div>

                                {/* Description */}
                                {selectedCompletion.tasks?.description && (
                                    <div>
                                        <p className="font-medium mb-1">Description:</p>
                                        <p className="text-muted-foreground bg-muted p-3 rounded">
                                            {selectedCompletion.tasks.description}
                                        </p>
                                    </div>
                                )}

                                {/* Location */}
                                {selectedCompletion.tasks?.location && (
                                    <div>
                                        <p className="font-medium mb-1">Location:</p>
                                        <p className="text-muted-foreground">📍 {selectedCompletion.tasks.location}</p>
                                    </div>
                                )}

                                {/* Notes */}
                                {selectedCompletion.notes && (
                                    <div>
                                        <p className="font-medium mb-1">📝 Employee Notes:</p>
                                        <p className="bg-muted p-3 rounded">{selectedCompletion.notes}</p>
                                    </div>
                                )}

                                {/* Photo */}
                                {selectedCompletion.photo_url && (
                                    <div>
                                        <p className="font-medium mb-2">📷 Photo Submission:</p>
                                        {signedPhotoUrl ? (
                                            <img
                                                src={signedPhotoUrl}
                                                alt="Task completion photo"
                                                className="max-w-full h-auto rounded-lg border max-h-96 object-contain"
                                            />
                                        ) : (
                                            <p className="text-sm text-muted-foreground">Loading photo...</p>
                                        )}
                                    </div>
                                )}

                                {/* Video */}
                                {selectedCompletion.video_url && (
                                    <div>
                                        <p className="font-medium mb-2">🎥 Video Submission:</p>
                                        {signedVideoUrl ? (
                                            <video
                                                src={signedVideoUrl}
                                                controls
                                                className="max-w-full h-auto rounded-lg border max-h-96"
                                            />
                                        ) : (
                                            <p className="text-sm text-muted-foreground">Loading video...</p>
                                        )}
                                    </div>
                                )}

                                {/* No submissions */}
                                {!selectedCompletion.notes && !selectedCompletion.photo_url && !selectedCompletion.video_url && selectedCompletion.status === 'completed' && (
                                    <div className="p-4 bg-muted rounded-lg text-center text-muted-foreground">
                                        No notes or media were submitted for this task
                                    </div>
                                )}

                                {selectedCompletion.status !== 'completed' && (
                                    <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg text-center text-yellow-800 dark:text-yellow-200">
                                        This task has not been completed yet
                                    </div>
                                )}
                            </div>

                            <div className="mt-6 flex justify-end">
                                <button
                                    onClick={() => setSelectedCompletion(null)}
                                    className="btn-secondary"
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
