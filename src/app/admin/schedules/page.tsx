'use client'

import { useState, useMemo } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { createUntypedClient } from '@/lib/supabase/client'
import { useEmployees, useSchedules, invalidateQueries } from '@/lib/hooks/useData'
import { ScheduleStatus } from '@/types/supabase'
import { scheduleNotifications } from '@/lib/notifications'
import { getTodayNY, getDateNY, formatScheduleDate, formatTimeString } from '@/lib/utils'
import { RichTextEditor } from '@/components/RichTextEditor'

// Type for schedule data returned from useSchedules hook
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
    cancellation_reason: string | null
    employee?: {
        id: string
        display_name: string | null
        position: string | null
        profiles?: {
            email: string | null
            full_name: string | null
        } | null
    } | null
}

const statusColors: Record<ScheduleStatus, string> = {
    pending: 'badge-warning',
    confirmed: 'badge-success',
    cancellation_requested: 'badge-error',
    cancelled: 'badge-secondary',
    completed: 'badge-default',
}

const statusLabels: Record<ScheduleStatus, string> = {
    pending: 'Pending',
    confirmed: 'Confirmed',
    cancellation_requested: 'Cancel Requested',
    cancelled: 'Cancelled',
    completed: 'Completed',
}

// Extended employee type with shift info
interface EmployeeWithShift {
    id: string
    display_name: string | null
    position: string | null
    shift_type: string | null
    shift_start: string | null
    shift_end: string | null
    profiles: {
        full_name: string | null
        email: string | null
    } | null
}

export default function AdminSchedulesPage() {
    const { user } = useAuth()
    const { data: employees = [] } = useEmployees(true) as { data: EmployeeWithShift[] }
    const [showModal, setShowModal] = useState(false)
    const [saving, setSaving] = useState(false)
    const [statusFilter, setStatusFilter] = useState<ScheduleStatus | 'all'>('all')
    const [employeeFilter, setEmployeeFilter] = useState('')
    const [dateFilter, setDateFilter] = useState({
        start: getTodayNY(),
        end: getDateNY(30),
    })

    // Use SWR hook for cached, instant data loading
    const filters = useMemo(() => ({
        startDate: dateFilter.start,
        endDate: dateFilter.end,
        status: statusFilter === 'all' ? undefined : statusFilter,
        employeeId: employeeFilter || undefined,
    }), [dateFilter.start, dateFilter.end, statusFilter, employeeFilter])

    const { data: schedules = [], isLoading: loading, mutate: refreshSchedules } = useSchedules(filters)

    const [formData, setFormData] = useState({
        employee_id: '',
        schedule_date: '',
        start_time: '09:00',
        end_time: '17:00',
        title: '',
        description: '',
        location: '',
    })

    // Shift edit modal
    const [showShiftModal, setShowShiftModal] = useState(false)
    const [editingShiftEmployee, setEditingShiftEmployee] = useState<EmployeeWithShift | null>(null)
    const [shiftFormData, setShiftFormData] = useState({
        shift_type: 'full-time',
        shift_start: '',
        shift_end: '',
    })

    // Schedule edit modal
    const [showEditModal, setShowEditModal] = useState(false)
    const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null)
    const [editScheduleData, setEditScheduleData] = useState({
        schedule_date: '',
        start_time: '',
        end_time: '',
        title: '',
        description: '',
        location: '',
    })

    // Bulk schedule form
    const [showBulkModal, setShowBulkModal] = useState(false)
    const [bulkFormData, setBulkFormData] = useState({
        employee_id: '',
        start_date: '',
        end_date: '',
        days: [] as string[],
        start_time: '09:00',
        end_time: '17:00',
        title: '',
        location: '',
    })
    const [useCustomTimes, setUseCustomTimes] = useState(false)
    const [dayTimes, setDayTimes] = useState<Record<string, { start_time: string; end_time: string }>>({})

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (!user) return
        setSaving(true)

        try {
            const supabase = createUntypedClient()
            const { data, error } = await supabase
                .from('schedules')
                .insert({
                    employee_id: formData.employee_id,
                    schedule_date: formData.schedule_date,
                    start_time: formData.start_time,
                    end_time: formData.end_time,
                    title: formData.title || null,
                    description: formData.description || null,
                    location: formData.location || null,
                    status: 'pending',
                    created_by: user.id,
                })
                .select()
                .single()

            if (error) throw error

            // Send email notification (non-blocking)
            if (data?.id) {
                scheduleNotifications.assigned(data.id).catch(console.error)
            }

            alert('Schedule created successfully!')
            setShowModal(false)
            setFormData({
                employee_id: '',
                schedule_date: '',
                start_time: '09:00',
                end_time: '17:00',
                title: '',
                description: '',
                location: '',
            })
            refreshSchedules()
        } catch (err: unknown) {
            const error = err as Error
            console.error('Error creating schedule:', error)
            alert('Error: ' + error.message)
        } finally {
            setSaving(false)
        }
    }

    async function handleBulkSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (!user) return
        if (bulkFormData.days.length === 0) {
            alert('Please select at least one day of the week')
            return
        }
        setSaving(true)

        try {
            const supabase = createUntypedClient()
            const schedules = []

            // Generate schedules for each day in the date range
            // Parse dates as local dates (YYYY-MM-DD format)
            const [startYear, startMonth, startDay] = bulkFormData.start_date.split('-').map(Number)
            const [endYear, endMonth, endDay] = bulkFormData.end_date.split('-').map(Number)
            const startDate = new Date(startYear, startMonth - 1, startDay)
            const endDate = new Date(endYear, endMonth - 1, endDay)

            const currentDate = new Date(startDate)
            while (currentDate <= endDate) {
                const dayName = currentDate.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase()
                if (bulkFormData.days.includes(dayName)) {
                    // Format date as YYYY-MM-DD using local date components
                    const year = currentDate.getFullYear()
                    const month = String(currentDate.getMonth() + 1).padStart(2, '0')
                    const day = String(currentDate.getDate()).padStart(2, '0')
                    const dateStr = `${year}-${month}-${day}`

                    // Use per-day times if custom mode, otherwise use global times
                    const times = useCustomTimes && dayTimes[dayName]
                        ? dayTimes[dayName]
                        : { start_time: bulkFormData.start_time, end_time: bulkFormData.end_time }

                    schedules.push({
                        employee_id: bulkFormData.employee_id,
                        schedule_date: dateStr,
                        start_time: times.start_time,
                        end_time: times.end_time,
                        title: bulkFormData.title || null,
                        location: bulkFormData.location || null,
                        status: 'pending',
                        created_by: user.id,
                    })
                }
                currentDate.setDate(currentDate.getDate() + 1)
            }

            if (schedules.length === 0) {
                alert('No schedules to create based on selected criteria')
                setSaving(false)
                return
            }

            const { error } = await supabase.from('schedules').insert(schedules)

            if (error) throw error

            // Find employee name for notification
            const selectedEmployee = employees.find((emp: { id: string }) => emp.id === bulkFormData.employee_id) as { id: string; display_name: string | null; profiles: { full_name: string | null } | null } | undefined
            const employeeName = selectedEmployee?.display_name || selectedEmployee?.profiles?.full_name || 'Employee'

            // Send admin notification about bulk schedules (non-blocking)
            scheduleNotifications.bulkCreated({
                employeeId: bulkFormData.employee_id,
                employeeName,
                scheduleCount: schedules.length,
                startDate: bulkFormData.start_date,
                endDate: bulkFormData.end_date,
                days: bulkFormData.days,
                startTime: bulkFormData.start_time,
                endTime: bulkFormData.end_time,
                dayTimes: useCustomTimes ? dayTimes : undefined,
            }).catch(console.error)

            alert(`${schedules.length} schedules created successfully!`)
            setShowBulkModal(false)
            setBulkFormData({
                employee_id: '',
                start_date: '',
                end_date: '',
                days: [],
                start_time: '09:00',
                end_time: '17:00',
                title: '',
                location: '',
            })
            setUseCustomTimes(false)
            setDayTimes({})
            refreshSchedules()
        } catch (err: unknown) {
            const error = err as Error
            console.error('Error creating bulk schedules:', error)
            alert('Error: ' + error.message)
        } finally {
            setSaving(false)
        }
    }

    async function handleCancel(scheduleId: string, reason?: string) {
        if (!user) return
        if (!confirm('Are you sure you want to cancel this schedule?')) return

        try {
            const supabase = createUntypedClient()
            const { error } = await supabase
                .from('schedules')
                .update({
                    status: 'cancelled',
                    cancelled_at: new Date().toISOString(),
                    cancelled_by: user.id,
                    cancellation_reason: reason || 'Cancelled by admin',
                })
                .eq('id', scheduleId)

            if (error) throw error

            // Send email notification (non-blocking)
            scheduleNotifications.adminCancelled(scheduleId, reason).catch(console.error)

            refreshSchedules()
            invalidateQueries.all()
        } catch (err: unknown) {
            const error = err as Error
            console.error('Error cancelling schedule:', error)
            alert('Error: ' + error.message)
        }
    }

    async function handleApproveCancellation(scheduleId: string) {
        if (!user) return
        if (!confirm('Approve this cancellation request?')) return

        try {
            const supabase = createUntypedClient()
            const { error } = await supabase
                .from('schedules')
                .update({
                    status: 'cancelled',
                    cancelled_at: new Date().toISOString(),
                    cancelled_by: user.id,
                })
                .eq('id', scheduleId)

            if (error) throw error

            // Send email notification (non-blocking)
            scheduleNotifications.cancellationApproved(scheduleId).catch(console.error)

            refreshSchedules()
            invalidateQueries.all()
        } catch (err: unknown) {
            const error = err as Error
            console.error('Error approving cancellation:', error)
            alert('Error: ' + error.message)
        }
    }

    async function handleDelete(scheduleId: string) {
        if (!confirm('Are you sure you want to delete this schedule? This cannot be undone.')) return

        try {
            // Send notification BEFORE deleting (need schedule data for email)
            await scheduleNotifications.deleted(scheduleId)

            const supabase = createUntypedClient()
            const { error } = await supabase
                .from('schedules')
                .delete()
                .eq('id', scheduleId)

            if (error) throw error
            refreshSchedules()
        } catch (err: unknown) {
            const error = err as Error
            console.error('Error deleting schedule:', error)
            alert('Error: ' + error.message)
        }
    }

    const pendingCount = schedules.filter((s: { status: string }) => s.status === 'pending').length
    const cancellationRequestedCount = schedules.filter((s: { status: string }) => s.status === 'cancellation_requested').length

    // Get selected employee for shift info display
    const selectedEmployee = formData.employee_id
        ? employees.find((emp) => emp.id === formData.employee_id)
        : null
    const selectedBulkEmployee = bulkFormData.employee_id
        ? employees.find((emp) => emp.id === bulkFormData.employee_id)
        : null

    // Apply employee's default shift times (using functional updater to avoid stale closures)
    function applyEmployeeShift() {
        const start = selectedEmployee?.shift_start
        const end = selectedEmployee?.shift_end
        if (start && end) {
            setFormData(prev => ({
                ...prev,
                start_time: start.slice(0, 5),
                end_time: end.slice(0, 5),
            }))
        }
    }

    function applyBulkEmployeeShift() {
        const start = selectedBulkEmployee?.shift_start
        const end = selectedBulkEmployee?.shift_end
        if (start && end) {
            setBulkFormData(prev => ({
                ...prev,
                start_time: start.slice(0, 5),
                end_time: end.slice(0, 5),
            }))
            // Also fill all checked days if in custom times mode
            if (useCustomTimes && bulkFormData.days.length > 0) {
                const newDayTimes: Record<string, { start_time: string; end_time: string }> = {}
                for (const day of bulkFormData.days) {
                    newDayTimes[day] = { start_time: start.slice(0, 5), end_time: end.slice(0, 5) }
                }
                setDayTimes(prev => ({ ...prev, ...newDayTimes }))
            }
        }
    }

    // Open shift edit modal
    function openShiftModal(emp: EmployeeWithShift) {
        setEditingShiftEmployee(emp)
        setShiftFormData({
            shift_type: emp.shift_type || 'full-time',
            shift_start: emp.shift_start?.slice(0, 5) || '',
            shift_end: emp.shift_end?.slice(0, 5) || '',
        })
        setShowShiftModal(true)
    }

    // Save shift changes
    async function handleShiftSave(e: React.FormEvent) {
        e.preventDefault()
        if (!editingShiftEmployee) return
        setSaving(true)

        try {
            const supabase = createUntypedClient()
            const { error } = await supabase
                .from('employees')
                .update({
                    shift_type: shiftFormData.shift_type,
                    shift_start: shiftFormData.shift_start || null,
                    shift_end: shiftFormData.shift_end || null,
                })
                .eq('id', editingShiftEmployee.id)

            if (error) throw error

            alert('Shift updated successfully!')
            setShowShiftModal(false)
            setEditingShiftEmployee(null)
            invalidateQueries.all()
        } catch (err: unknown) {
            const error = err as Error
            console.error('Error updating shift:', error)
            alert('Error: ' + error.message)
        } finally {
            setSaving(false)
        }
    }

    // Open schedule edit modal
    function openEditScheduleModal(schedule: Schedule) {
        setEditingSchedule(schedule)
        setEditScheduleData({
            schedule_date: schedule.schedule_date,
            start_time: schedule.start_time.slice(0, 5),
            end_time: schedule.end_time.slice(0, 5),
            title: schedule.title || '',
            description: schedule.description || '',
            location: schedule.location || '',
        })
        setShowEditModal(true)
    }

    // Save schedule changes
    async function handleEditScheduleSave(e: React.FormEvent) {
        e.preventDefault()
        if (!editingSchedule) return
        setSaving(true)

        try {
            const supabase = createUntypedClient()
            const { error } = await supabase
                .from('schedules')
                .update({
                    schedule_date: editScheduleData.schedule_date,
                    start_time: editScheduleData.start_time,
                    end_time: editScheduleData.end_time,
                    title: editScheduleData.title || null,
                    description: editScheduleData.description || null,
                    location: editScheduleData.location || null,
                })
                .eq('id', editingSchedule.id)

            if (error) throw error

            alert('Schedule updated successfully!')
            setShowEditModal(false)
            setEditingSchedule(null)
            refreshSchedules()
        } catch (err: unknown) {
            const error = err as Error
            console.error('Error updating schedule:', error)
            alert('Error: ' + error.message)
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="space-y-4 sm:space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold">Schedules</h1>
                    <p className="text-muted-foreground mt-1 text-sm sm:text-base">
                        Manage employee work schedules
                    </p>
                </div>
                <div className="flex gap-2">
                    <button className="btn-secondary text-xs sm:text-sm" onClick={() => setShowBulkModal(true)}>
                        Bulk Create
                    </button>
                    <button className="btn-primary text-xs sm:text-sm" onClick={() => setShowModal(true)}>
                        + Add Schedule
                    </button>
                </div>
            </div>

            {/* Stats Cards - clickable to filter */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
                <button
                    className={`card p-3 sm:p-4 text-left cursor-pointer transition-all ${statusFilter === 'all' ? 'ring-2 ring-primary' : 'hover:ring-1 hover:ring-muted-foreground/30'}`}
                    onClick={() => setStatusFilter('all')}
                >
                    <p className="text-xs sm:text-sm text-muted-foreground">Total Schedules</p>
                    <p className="text-xl sm:text-2xl font-bold">{schedules.length}</p>
                </button>
                <button
                    className={`card p-3 sm:p-4 text-left cursor-pointer transition-all ${statusFilter === 'pending' ? 'ring-2 ring-yellow-500' : 'hover:ring-1 hover:ring-muted-foreground/30'}`}
                    onClick={() => setStatusFilter(statusFilter === 'pending' ? 'all' : 'pending')}
                >
                    <p className="text-xs sm:text-sm text-muted-foreground">Pending Confirmation</p>
                    <p className="text-xl sm:text-2xl font-bold text-yellow-600">{pendingCount}</p>
                </button>
                <button
                    className={`card p-3 sm:p-4 text-left cursor-pointer transition-all ${statusFilter === 'cancellation_requested' ? 'ring-2 ring-red-500' : 'hover:ring-1 hover:ring-muted-foreground/30'}`}
                    onClick={() => setStatusFilter(statusFilter === 'cancellation_requested' ? 'all' : 'cancellation_requested')}
                >
                    <p className="text-xs sm:text-sm text-muted-foreground">Cancel Requests</p>
                    <p className="text-xl sm:text-2xl font-bold text-red-600">{cancellationRequestedCount}</p>
                </button>
                <button
                    className={`card p-3 sm:p-4 text-left cursor-pointer transition-all ${statusFilter === 'confirmed' ? 'ring-2 ring-green-500' : 'hover:ring-1 hover:ring-muted-foreground/30'}`}
                    onClick={() => setStatusFilter(statusFilter === 'confirmed' ? 'all' : 'confirmed')}
                >
                    <p className="text-xs sm:text-sm text-muted-foreground">Confirmed</p>
                    <p className="text-xl sm:text-2xl font-bold text-green-600">
                        {schedules.filter((s: { status: string }) => s.status === 'confirmed').length}
                    </p>
                </button>
            </div>

            {/* Employee Shifts Reference */}
            <div className="card p-4">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-lg">Employee Shift Timings</h3>
                    <span className="text-xs text-muted-foreground">{employees.filter(emp => emp.id).length} employees</span>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b">
                                <th className="text-left py-2 px-3 font-medium">Employee</th>
                                <th className="text-left py-2 px-3 font-medium">Shift Type</th>
                                <th className="text-left py-2 px-3 font-medium">Shift Hours</th>
                                <th className="text-right py-2 px-3 font-medium">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {employees.filter(emp => emp.id).map((emp) => (
                                <tr key={emp.id} className="border-b border-muted/50 hover:bg-muted/20">
                                    <td className="py-2 px-3 font-medium">{emp.display_name || emp.profiles?.full_name || 'Unknown'}</td>
                                    <td className="py-2 px-3">
                                        <span className="capitalize badge badge-outline text-xs">
                                            {emp.shift_type || 'Not set'}
                                        </span>
                                    </td>
                                    <td className="py-2 px-3">
                                        {emp.shift_start && emp.shift_end
                                            ? <span className="text-primary font-medium">{formatTimeString(emp.shift_start)} - {formatTimeString(emp.shift_end)}</span>
                                            : <span className="text-muted-foreground">Not set</span>
                                        }
                                    </td>
                                    <td className="py-2 px-3 text-right">
                                        <button
                                            onClick={() => openShiftModal(emp)}
                                            className="text-xs text-primary hover:underline"
                                        >
                                            Change Shift
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Filters */}
            <div className="card p-4">
                <h3 className="font-semibold text-lg mb-4">Filters for Specific Schedules</h3>
                <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
                    <div>
                        <label className="label">Start Date</label>
                        <input
                            type="date"
                            className="input"
                            value={dateFilter.start}
                            onChange={(e) => setDateFilter({ ...dateFilter, start: e.target.value })}
                        />
                    </div>
                    <div>
                        <label className="label">End Date</label>
                        <input
                            type="date"
                            className="input"
                            value={dateFilter.end}
                            onChange={(e) => setDateFilter({ ...dateFilter, end: e.target.value })}
                        />
                    </div>
                    <div>
                        <label className="label">Employee</label>
                        <select
                            className="input"
                            value={employeeFilter}
                            onChange={(e) => setEmployeeFilter(e.target.value)}
                        >
                            <option value="">All Employees</option>
                            {employees.filter(emp => emp.id).map((emp) => (
                                <option key={emp.id} value={emp.id}>
                                    {emp.display_name || emp.profiles?.full_name || 'Unknown'}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="label">Status</label>
                        <select
                            className="input"
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value as ScheduleStatus | 'all')}
                        >
                            <option value="all">All Statuses</option>
                            <option value="pending">Pending</option>
                            <option value="confirmed">Confirmed</option>
                            <option value="cancellation_requested">Cancel Requested</option>
                            <option value="cancelled">Cancelled</option>
                            <option value="completed">Completed</option>
                        </select>
                    </div>
                    <div className="flex items-end">
                        <button className="btn-secondary w-full" onClick={() => refreshSchedules()}>
                            Refresh
                        </button>
                    </div>
                </div>
            </div>

            {/* Create Schedule Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-card rounded-lg shadow-lg w-full max-w-md max-h-[90vh] overflow-y-auto">
                        <div className="p-4 sm:p-6">
                            <h2 className="text-lg sm:text-xl font-bold mb-4">Create Schedule</h2>
                            <form onSubmit={handleSubmit} className="space-y-4">
                                <div>
                                    <label className="label">Employee *</label>
                                    <select
                                        required
                                        className="input"
                                        value={formData.employee_id}
                                        onChange={(e) => setFormData({ ...formData, employee_id: e.target.value })}
                                    >
                                        <option value="">Select employee...</option>
                                        {employees.filter(emp => emp.id).map((emp) => (
                                            <option key={emp.id} value={emp.id}>
                                                {emp.display_name || emp.profiles?.full_name || 'Unknown'}
                                            </option>
                                        ))}
                                    </select>
                                    {/* Show employee's default shift info */}
                                    {selectedEmployee && (selectedEmployee.shift_start || selectedEmployee.shift_type) && (
                                        <div className="mt-2 p-2 bg-blue-50 rounded-lg text-sm">
                                            <div className="flex items-center justify-between">
                                                <div className="text-blue-800">
                                                    <span className="font-medium">Default Shift:</span>{' '}
                                                    {selectedEmployee.shift_type && <span className="capitalize">{selectedEmployee.shift_type}</span>}
                                                    {selectedEmployee.shift_start && selectedEmployee.shift_end && (
                                                        <span> ({formatTimeString(selectedEmployee.shift_start)} - {formatTimeString(selectedEmployee.shift_end)})</span>
                                                    )}
                                                </div>
                                                {selectedEmployee.shift_start && selectedEmployee.shift_end && (
                                                    <button
                                                        type="button"
                                                        onClick={applyEmployeeShift}
                                                        className="text-xs text-blue-600 hover:text-blue-800 underline"
                                                    >
                                                        Use This
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <div>
                                    <label className="label">Date *</label>
                                    <input
                                        type="date"
                                        required
                                        className="input"
                                        value={formData.schedule_date}
                                        onChange={(e) => setFormData({ ...formData, schedule_date: e.target.value })}
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="label">Start Time *</label>
                                        <input
                                            type="time"
                                            required
                                            className="input"
                                            value={formData.start_time}
                                            onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="label">End Time *</label>
                                        <input
                                            type="time"
                                            required
                                            className="input"
                                            value={formData.end_time}
                                            onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="label">Title</label>
                                    <input
                                        type="text"
                                        className="input"
                                        placeholder="e.g., Morning Shift"
                                        value={formData.title}
                                        onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="label">Location</label>
                                    <input
                                        type="text"
                                        className="input"
                                        placeholder="e.g., Main Floor"
                                        value={formData.location}
                                        onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="label">Description</label>
                                    <RichTextEditor
                                        value={formData.description}
                                        onChange={(value) => setFormData({ ...formData, description: value })}
                                        placeholder="Enter schedule description..."
                                        minHeight="80px"
                                    />
                                </div>
                                <div className="flex gap-3 pt-4">
                                    <button type="button" className="btn-secondary flex-1" onClick={() => setShowModal(false)}>
                                        Cancel
                                    </button>
                                    <button type="submit" className="btn-primary flex-1" disabled={saving}>
                                        {saving ? 'Creating...' : 'Create Schedule'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}

            {/* Bulk Create Modal */}
            {showBulkModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-card rounded-lg shadow-lg w-full max-w-md max-h-[90vh] overflow-y-auto">
                        <div className="p-4 sm:p-6">
                            <h2 className="text-lg sm:text-xl font-bold mb-4">Bulk Create Schedules</h2>
                            <form onSubmit={handleBulkSubmit} className="space-y-4">
                                <div>
                                    <label className="label">Employee *</label>
                                    <select
                                        required
                                        className="input"
                                        value={bulkFormData.employee_id}
                                        onChange={(e) => setBulkFormData({ ...bulkFormData, employee_id: e.target.value })}
                                    >
                                        <option value="">Select employee...</option>
                                        {employees.filter(emp => emp.id).map((emp) => (
                                            <option key={emp.id} value={emp.id}>
                                                {emp.display_name || emp.profiles?.full_name || 'Unknown'}
                                            </option>
                                        ))}
                                    </select>
                                    {/* Show employee's default shift info */}
                                    {selectedBulkEmployee && (selectedBulkEmployee.shift_start || selectedBulkEmployee.shift_type) && (
                                        <div className="mt-2 p-2 bg-blue-50 rounded-lg text-sm">
                                            <div className="flex items-center justify-between">
                                                <div className="text-blue-800">
                                                    <span className="font-medium">Default Shift:</span>{' '}
                                                    {selectedBulkEmployee.shift_type && <span className="capitalize">{selectedBulkEmployee.shift_type}</span>}
                                                    {selectedBulkEmployee.shift_start && selectedBulkEmployee.shift_end && (
                                                        <span> ({formatTimeString(selectedBulkEmployee.shift_start)} - {formatTimeString(selectedBulkEmployee.shift_end)})</span>
                                                    )}
                                                </div>
                                                {selectedBulkEmployee.shift_start && selectedBulkEmployee.shift_end && (
                                                    <button
                                                        type="button"
                                                        onClick={applyBulkEmployeeShift}
                                                        className="text-xs text-blue-600 hover:text-blue-800 underline"
                                                    >
                                                        Use This
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="label">Start Date *</label>
                                        <input
                                            type="date"
                                            required
                                            className="input"
                                            value={bulkFormData.start_date}
                                            onChange={(e) => setBulkFormData({ ...bulkFormData, start_date: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="label">End Date *</label>
                                        <input
                                            type="date"
                                            required
                                            className="input"
                                            value={bulkFormData.end_date}
                                            onChange={(e) => setBulkFormData({ ...bulkFormData, end_date: e.target.value })}
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="label">Days of Week *</label>
                                    <div className="flex flex-wrap gap-2">
                                        {['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((day) => (
                                            <label key={day} className="flex items-center gap-1 text-sm">
                                                <input
                                                    type="checkbox"
                                                    checked={bulkFormData.days.includes(day)}
                                                    onChange={(e) => {
                                                        if (e.target.checked) {
                                                            setBulkFormData(prev => ({ ...prev, days: [...prev.days, day] }))
                                                            // Initialize per-day time with global defaults
                                                            if (useCustomTimes) {
                                                                setDayTimes(prev => ({
                                                                    ...prev,
                                                                    [day]: { start_time: bulkFormData.start_time, end_time: bulkFormData.end_time }
                                                                }))
                                                            }
                                                        } else {
                                                            setBulkFormData(prev => ({ ...prev, days: prev.days.filter(d => d !== day) }))
                                                            // Clean up per-day time
                                                            setDayTimes(prev => {
                                                                const next = { ...prev }
                                                                delete next[day]
                                                                return next
                                                            })
                                                        }
                                                    }}
                                                    className="rounded border-gray-300"
                                                />
                                                {day.charAt(0).toUpperCase() + day.slice(1, 3)}
                                            </label>
                                        ))}
                                    </div>
                                </div>
                                {/* Toggle: Same time vs Custom per day */}
                                <div>
                                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={useCustomTimes}
                                            onChange={(e) => {
                                                setUseCustomTimes(e.target.checked)
                                                if (e.target.checked) {
                                                    // Initialize all checked days with current global time
                                                    const init: Record<string, { start_time: string; end_time: string }> = {}
                                                    for (const day of bulkFormData.days) {
                                                        init[day] = { start_time: bulkFormData.start_time, end_time: bulkFormData.end_time }
                                                    }
                                                    setDayTimes(init)
                                                }
                                            }}
                                            className="rounded border-gray-300"
                                        />
                                        <span className="font-medium">Custom time per day</span>
                                    </label>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        {useCustomTimes ? 'Set different start/end times for each day' : 'Same start/end time for all selected days'}
                                    </p>
                                </div>
                                {!useCustomTimes ? (
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="label">Start Time *</label>
                                            <input
                                                type="time"
                                                required
                                                className="input"
                                                value={bulkFormData.start_time}
                                                onChange={(e) => setBulkFormData({ ...bulkFormData, start_time: e.target.value })}
                                            />
                                        </div>
                                        <div>
                                            <label className="label">End Time *</label>
                                            <input
                                                type="time"
                                                required
                                                className="input"
                                                value={bulkFormData.end_time}
                                                onChange={(e) => setBulkFormData({ ...bulkFormData, end_time: e.target.value })}
                                            />
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        {bulkFormData.days.length === 0 ? (
                                            <p className="text-sm text-muted-foreground italic">Select days above to set times</p>
                                        ) : (
                                            bulkFormData.days
                                                .sort((a, b) => {
                                                    const order = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
                                                    return order.indexOf(a) - order.indexOf(b)
                                                })
                                                .map((day) => (
                                                    <div key={day} className="flex items-center gap-2 p-2 bg-muted/30 rounded-lg">
                                                        <span className="text-sm font-medium w-12 capitalize">{day.slice(0, 3)}</span>
                                                        <input
                                                            type="time"
                                                            required
                                                            className="input flex-1 text-sm"
                                                            value={dayTimes[day]?.start_time || '09:00'}
                                                            onChange={(e) => setDayTimes(prev => ({
                                                                ...prev,
                                                                [day]: { ...prev[day], start_time: e.target.value }
                                                            }))}
                                                        />
                                                        <span className="text-xs text-muted-foreground">to</span>
                                                        <input
                                                            type="time"
                                                            required
                                                            className="input flex-1 text-sm"
                                                            value={dayTimes[day]?.end_time || '17:00'}
                                                            onChange={(e) => setDayTimes(prev => ({
                                                                ...prev,
                                                                [day]: { ...prev[day], end_time: e.target.value }
                                                            }))}
                                                        />
                                                    </div>
                                                ))
                                        )}
                                    </div>
                                )}
                                <div>
                                    <label className="label">Title</label>
                                    <input
                                        type="text"
                                        className="input"
                                        placeholder="e.g., Regular Shift"
                                        value={bulkFormData.title}
                                        onChange={(e) => setBulkFormData({ ...bulkFormData, title: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="label">Location</label>
                                    <input
                                        type="text"
                                        className="input"
                                        value={bulkFormData.location}
                                        onChange={(e) => setBulkFormData({ ...bulkFormData, location: e.target.value })}
                                    />
                                </div>
                                <div className="flex gap-3 pt-4">
                                    <button type="button" className="btn-secondary flex-1" onClick={() => setShowBulkModal(false)}>
                                        Cancel
                                    </button>
                                    <button type="submit" className="btn-primary flex-1" disabled={saving}>
                                        {saving ? 'Creating...' : 'Create Schedules'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}

            {/* Shift Edit Modal */}
            {showShiftModal && editingShiftEmployee && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-card rounded-lg shadow-lg w-full max-w-md">
                        <div className="p-4 sm:p-6">
                            <h2 className="text-lg sm:text-xl font-bold mb-2">Change Shift</h2>
                            <p className="text-muted-foreground mb-4">
                                {editingShiftEmployee.display_name || editingShiftEmployee.profiles?.full_name}
                            </p>
                            <form onSubmit={handleShiftSave} className="space-y-4">
                                <div>
                                    <label className="label">Shift Type</label>
                                    <select
                                        className="input"
                                        value={shiftFormData.shift_type}
                                        onChange={(e) => setShiftFormData({ ...shiftFormData, shift_type: e.target.value })}
                                    >
                                        <option value="full-time">Full Time</option>
                                        <option value="part-time">Part Time</option>
                                        <option value="contract">Contract</option>
                                        <option value="flexible">Flexible</option>
                                    </select>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="label">Shift Start</label>
                                        <input
                                            type="time"
                                            className="input"
                                            value={shiftFormData.shift_start}
                                            onChange={(e) => setShiftFormData({ ...shiftFormData, shift_start: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="label">Shift End</label>
                                        <input
                                            type="time"
                                            className="input"
                                            value={shiftFormData.shift_end}
                                            onChange={(e) => setShiftFormData({ ...shiftFormData, shift_end: e.target.value })}
                                        />
                                    </div>
                                </div>
                                <div className="flex gap-3 pt-4">
                                    <button
                                        type="button"
                                        className="btn-secondary flex-1"
                                        onClick={() => { setShowShiftModal(false); setEditingShiftEmployee(null); }}
                                    >
                                        Cancel
                                    </button>
                                    <button type="submit" className="btn-primary flex-1" disabled={saving}>
                                        {saving ? 'Saving...' : 'Save Shift'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}

            {/* Schedule Edit Modal */}
            {showEditModal && editingSchedule && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-card rounded-lg shadow-lg w-full max-w-md max-h-[90vh] overflow-y-auto">
                        <div className="p-4 sm:p-6">
                            <h2 className="text-lg sm:text-xl font-bold mb-4">Edit Schedule</h2>
                            <form onSubmit={handleEditScheduleSave} className="space-y-4">
                                <div>
                                    <label className="label">Date *</label>
                                    <input
                                        type="date"
                                        required
                                        className="input"
                                        value={editScheduleData.schedule_date}
                                        onChange={(e) => setEditScheduleData({ ...editScheduleData, schedule_date: e.target.value })}
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="label">Start Time *</label>
                                        <input
                                            type="time"
                                            required
                                            className="input"
                                            value={editScheduleData.start_time}
                                            onChange={(e) => setEditScheduleData({ ...editScheduleData, start_time: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="label">End Time *</label>
                                        <input
                                            type="time"
                                            required
                                            className="input"
                                            value={editScheduleData.end_time}
                                            onChange={(e) => setEditScheduleData({ ...editScheduleData, end_time: e.target.value })}
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="label">Title</label>
                                    <input
                                        type="text"
                                        className="input"
                                        value={editScheduleData.title}
                                        onChange={(e) => setEditScheduleData({ ...editScheduleData, title: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="label">Location</label>
                                    <input
                                        type="text"
                                        className="input"
                                        value={editScheduleData.location}
                                        onChange={(e) => setEditScheduleData({ ...editScheduleData, location: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="label">Description</label>
                                    <RichTextEditor
                                        value={editScheduleData.description}
                                        onChange={(value) => setEditScheduleData({ ...editScheduleData, description: value })}
                                        placeholder="Enter schedule description..."
                                        minHeight="80px"
                                    />
                                </div>
                                <div className="flex gap-3 pt-4">
                                    <button
                                        type="button"
                                        className="btn-secondary flex-1"
                                        onClick={() => { setShowEditModal(false); setEditingSchedule(null); }}
                                    >
                                        Cancel
                                    </button>
                                    <button type="submit" className="btn-primary flex-1" disabled={saving}>
                                        {saving ? 'Saving...' : 'Save Changes'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}

            {/* Schedules List */}
            {loading ? (
                <div className="space-y-3 sm:space-y-4">
                    {[...Array(5)].map((_, i) => (
                        <div key={i} className="h-20 bg-muted rounded-lg animate-pulse"></div>
                    ))}
                </div>
            ) : schedules.length === 0 ? (
                <div className="card p-6 sm:p-8 text-center">
                    <p className="text-muted-foreground text-sm sm:text-base">No schedules found</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {schedules.map((schedule: Schedule) => {
                        // Find employee's default shift for comparison
                        const emp = employees.find(e => e.id === schedule.employee_id)
                        const hasDefaultShift = emp?.shift_start && emp?.shift_end

                        return (
                        <div key={schedule.id} className="card p-4">
                            <div className="flex flex-col sm:flex-row justify-between gap-3">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="font-medium">
                                            {schedule.employee?.display_name || schedule.employee?.profiles?.full_name || 'Unknown'}
                                        </span>
                                        <span className={`badge ${statusColors[schedule.status]}`}>
                                            {statusLabels[schedule.status]}
                                        </span>
                                        {emp?.shift_type && (
                                            <span className="badge badge-outline text-xs capitalize">
                                                {emp.shift_type}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-sm text-muted-foreground">
                                        {formatScheduleDate(schedule.schedule_date)}
                                    </p>
                                    <p className="text-sm">
                                        {formatTimeString(schedule.start_time)} - {formatTimeString(schedule.end_time)}
                                        {schedule.location && ` | ${schedule.location}`}
                                    </p>
                                    {hasDefaultShift && (
                                        <p className="text-xs text-muted-foreground">
                                            Default shift: {formatTimeString(emp.shift_start)} - {formatTimeString(emp.shift_end)}
                                        </p>
                                    )}
                                    {schedule.title && (
                                        <p className="text-sm font-medium mt-1">{schedule.title}</p>
                                    )}
                                    {schedule.description && (
                                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{schedule.description.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100)}</p>
                                    )}
                                    {schedule.cancellation_reason && (
                                        <p className="text-sm text-red-600 mt-1">
                                            Reason: {schedule.cancellation_reason}
                                        </p>
                                    )}
                                </div>
                                <div className="flex gap-2 flex-shrink-0">
                                    {schedule.status === 'cancellation_requested' && (
                                        <button
                                            className="btn-primary btn-sm"
                                            onClick={() => handleApproveCancellation(schedule.id)}
                                        >
                                            Approve Cancel
                                        </button>
                                    )}
                                    {schedule.status !== 'cancelled' && schedule.status !== 'completed' && (
                                        <>
                                            <button
                                                className="btn-secondary btn-sm"
                                                onClick={() => openEditScheduleModal(schedule)}
                                            >
                                                Edit
                                            </button>
                                            <button
                                                className="btn-secondary btn-sm"
                                                onClick={() => handleCancel(schedule.id)}
                                            >
                                                Cancel
                                            </button>
                                        </>
                                    )}
                                    <button
                                        className="btn-ghost btn-sm text-red-600"
                                        onClick={() => handleDelete(schedule.id)}
                                    >
                                        Delete
                                    </button>
                                </div>
                            </div>
                        </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
