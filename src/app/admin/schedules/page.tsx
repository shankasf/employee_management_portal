'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { createUntypedClient } from '@/lib/supabase/client'
import { useEmployees, invalidateQueries } from '@/lib/hooks/useData'
import { ScheduleStatus } from '@/types/supabase'

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
    created_by: string
    confirmed_at: string | null
    cancellation_requested_at: string | null
    cancellation_reason: string | null
    cancelled_at: string | null
    cancelled_by: string | null
    created_at: string
    employee?: {
        id: string
        display_name: string | null
        position: string | null
        profiles: {
            email: string | null
            full_name: string | null
        } | null
    }
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

export default function AdminSchedulesPage() {
    const { user } = useAuth()
    const { data: employees = [] } = useEmployees(false)
    const [schedules, setSchedules] = useState<Schedule[]>([])
    const [loading, setLoading] = useState(true)
    const [showModal, setShowModal] = useState(false)
    const [saving, setSaving] = useState(false)
    const [statusFilter, setStatusFilter] = useState<ScheduleStatus | 'all'>('all')
    const [dateFilter, setDateFilter] = useState({
        start: new Date().toISOString().split('T')[0],
        end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    })

    const [formData, setFormData] = useState({
        employee_id: '',
        schedule_date: '',
        start_time: '09:00',
        end_time: '17:00',
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

    useEffect(() => {
        loadSchedules()
    }, [statusFilter, dateFilter])

    async function loadSchedules() {
        setLoading(true)
        try {
            const supabase = createUntypedClient()
            let query = supabase
                .from('schedules')
                .select(`
                    *,
                    employee:employees (
                        id,
                        display_name,
                        position,
                        profiles (
                            email,
                            full_name
                        )
                    )
                `)
                .gte('schedule_date', dateFilter.start)
                .lte('schedule_date', dateFilter.end)
                .order('schedule_date', { ascending: true })
                .order('start_time', { ascending: true })

            if (statusFilter !== 'all') {
                query = query.eq('status', statusFilter)
            }

            const { data, error } = await query

            if (error) throw error
            setSchedules(data || [])
        } catch (err) {
            console.error('Error loading schedules:', err)
        } finally {
            setLoading(false)
        }
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (!user) return
        setSaving(true)

        try {
            const supabase = createUntypedClient()
            const { error } = await supabase
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

            if (error) throw error

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
            loadSchedules()
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

                    schedules.push({
                        employee_id: bulkFormData.employee_id,
                        schedule_date: dateStr,
                        start_time: bulkFormData.start_time,
                        end_time: bulkFormData.end_time,
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
            loadSchedules()
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
            loadSchedules()
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
            loadSchedules()
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
            const supabase = createUntypedClient()
            const { error } = await supabase
                .from('schedules')
                .delete()
                .eq('id', scheduleId)

            if (error) throw error
            loadSchedules()
        } catch (err: unknown) {
            const error = err as Error
            console.error('Error deleting schedule:', error)
            alert('Error: ' + error.message)
        }
    }

    const pendingCount = schedules.filter(s => s.status === 'pending').length
    const cancellationRequestedCount = schedules.filter(s => s.status === 'cancellation_requested').length

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

            {/* Stats Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
                <div className="card p-3 sm:p-4">
                    <p className="text-xs sm:text-sm text-muted-foreground">Total Schedules</p>
                    <p className="text-xl sm:text-2xl font-bold">{schedules.length}</p>
                </div>
                <div className="card p-3 sm:p-4">
                    <p className="text-xs sm:text-sm text-muted-foreground">Pending Confirmation</p>
                    <p className="text-xl sm:text-2xl font-bold text-yellow-600">{pendingCount}</p>
                </div>
                <div className="card p-3 sm:p-4">
                    <p className="text-xs sm:text-sm text-muted-foreground">Cancel Requests</p>
                    <p className="text-xl sm:text-2xl font-bold text-red-600">{cancellationRequestedCount}</p>
                </div>
                <div className="card p-3 sm:p-4">
                    <p className="text-xs sm:text-sm text-muted-foreground">Confirmed</p>
                    <p className="text-xl sm:text-2xl font-bold text-green-600">
                        {schedules.filter(s => s.status === 'confirmed').length}
                    </p>
                </div>
            </div>

            {/* Filters */}
            <div className="card p-4">
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
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
                        <button className="btn-secondary w-full" onClick={loadSchedules}>
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
                                        {employees.map((emp: { id: string; display_name: string | null; profiles: { full_name: string | null } | null }) => (
                                            <option key={emp.id} value={emp.id}>
                                                {emp.display_name || emp.profiles?.full_name || 'Unknown'}
                                            </option>
                                        ))}
                                    </select>
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
                                    <textarea
                                        className="input min-h-[80px]"
                                        value={formData.description}
                                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
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
                                        {employees.map((emp: { id: string; display_name: string | null; profiles: { full_name: string | null } | null }) => (
                                            <option key={emp.id} value={emp.id}>
                                                {emp.display_name || emp.profiles?.full_name || 'Unknown'}
                                            </option>
                                        ))}
                                    </select>
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
                                                            setBulkFormData({ ...bulkFormData, days: [...bulkFormData.days, day] })
                                                        } else {
                                                            setBulkFormData({ ...bulkFormData, days: bulkFormData.days.filter(d => d !== day) })
                                                        }
                                                    }}
                                                    className="rounded border-gray-300"
                                                />
                                                {day.charAt(0).toUpperCase() + day.slice(1, 3)}
                                            </label>
                                        ))}
                                    </div>
                                </div>
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
                    {schedules.map((schedule) => (
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
                                    </div>
                                    <p className="text-sm text-muted-foreground">
                                        {new Date(schedule.schedule_date).toLocaleDateString('en-US', {
                                            weekday: 'long',
                                            year: 'numeric',
                                            month: 'short',
                                            day: 'numeric',
                                        })}
                                    </p>
                                    <p className="text-sm">
                                        {schedule.start_time} - {schedule.end_time}
                                        {schedule.location && ` | ${schedule.location}`}
                                    </p>
                                    {schedule.title && (
                                        <p className="text-sm font-medium mt-1">{schedule.title}</p>
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
                                        <button
                                            className="btn-secondary btn-sm"
                                            onClick={() => handleCancel(schedule.id)}
                                        >
                                            Cancel
                                        </button>
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
                    ))}
                </div>
            )}
        </div>
    )
}
