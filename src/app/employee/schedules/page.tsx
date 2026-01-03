'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { createUntypedClient } from '@/lib/supabase/client'
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
    confirmed_at: string | null
    cancellation_requested_at: string | null
    cancellation_reason: string | null
    created_at: string
}

const statusColors: Record<ScheduleStatus, string> = {
    pending: 'badge-warning',
    confirmed: 'badge-success',
    cancellation_requested: 'badge-error',
    cancelled: 'badge-secondary',
    completed: 'badge-default',
}

const statusLabels: Record<ScheduleStatus, string> = {
    pending: 'Awaiting Confirmation',
    confirmed: 'Confirmed',
    cancellation_requested: 'Cancellation Pending',
    cancelled: 'Cancelled',
    completed: 'Completed',
}

export default function EmployeeSchedulesPage() {
    const { user, employee } = useAuth()
    const [schedules, setSchedules] = useState<Schedule[]>([])
    const [loading, setLoading] = useState(true)
    const [processing, setProcessing] = useState<string | null>(null)
    const [showCancelModal, setShowCancelModal] = useState(false)
    const [cancellingSchedule, setCancellingSchedule] = useState<Schedule | null>(null)
    const [cancellationReason, setCancellationReason] = useState('')
    const [filter, setFilter] = useState<'upcoming' | 'all' | 'pending'>('upcoming')

    useEffect(() => {
        if (user) {
            loadSchedules()
        }
    }, [user, filter])

    async function loadSchedules() {
        if (!user) return
        setLoading(true)
        try {
            const supabase = createUntypedClient()
            let query = supabase
                .from('schedules')
                .select('*')
                .eq('employee_id', user.id)
                .order('schedule_date', { ascending: true })
                .order('start_time', { ascending: true })

            if (filter === 'upcoming') {
                const today = new Date().toISOString().split('T')[0]
                query = query.gte('schedule_date', today).neq('status', 'cancelled')
            } else if (filter === 'pending') {
                query = query.eq('status', 'pending')
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

            alert('Schedule confirmed! A confirmation email will be sent to you and management.')
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

            alert('Cancellation request submitted. You will be notified once it is approved.')
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

    function openCancelModal(schedule: Schedule) {
        setCancellingSchedule(schedule)
        setCancellationReason('')
        setShowCancelModal(true)
    }

    // Get shift info for display
    const shiftInfo = employee ? {
        type: employee.shift_type,
        start: employee.shift_start,
        end: employee.shift_end,
        company: employee.company_name,
        location: employee.work_location,
    } : null

    const pendingCount = schedules.filter(s => s.status === 'pending').length

    return (
        <div className="space-y-4 sm:space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold">My Schedule</h1>
                    <p className="text-muted-foreground mt-1 text-sm sm:text-base">
                        View and manage your work schedules
                    </p>
                </div>
                {pendingCount > 0 && (
                    <div className="badge badge-warning">
                        {pendingCount} pending confirmation{pendingCount > 1 ? 's' : ''}
                    </div>
                )}
            </div>

            {/* Shift Info Card */}
            {shiftInfo && (shiftInfo.type || shiftInfo.start) && (
                <div className="card p-4 bg-primary/5">
                    <h3 className="font-semibold mb-2">Your Regular Shift</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                        {shiftInfo.type && (
                            <div>
                                <span className="text-muted-foreground">Type:</span> {shiftInfo.type}
                            </div>
                        )}
                        {shiftInfo.start && shiftInfo.end && (
                            <div>
                                <span className="text-muted-foreground">Hours:</span> {shiftInfo.start} - {shiftInfo.end}
                            </div>
                        )}
                        {shiftInfo.company && (
                            <div>
                                <span className="text-muted-foreground">Company:</span> {shiftInfo.company}
                            </div>
                        )}
                        {shiftInfo.location && (
                            <div>
                                <span className="text-muted-foreground">Location:</span> {shiftInfo.location}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Filter Tabs */}
            <div className="flex gap-2 border-b">
                <button
                    className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${filter === 'upcoming'
                        ? 'border-primary text-foreground'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                        }`}
                    onClick={() => setFilter('upcoming')}
                >
                    Upcoming
                </button>
                <button
                    className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${filter === 'pending'
                        ? 'border-primary text-foreground'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                        }`}
                    onClick={() => setFilter('pending')}
                >
                    Needs Confirmation
                    {pendingCount > 0 && (
                        <span className="ml-1 px-1.5 py-0.5 rounded-full bg-yellow-100 text-yellow-800 text-xs">
                            {pendingCount}
                        </span>
                    )}
                </button>
                <button
                    className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${filter === 'all'
                        ? 'border-primary text-foreground'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                        }`}
                    onClick={() => setFilter('all')}
                >
                    All
                </button>
            </div>

            {/* Cancellation Request Modal */}
            {showCancelModal && cancellingSchedule && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-card rounded-lg shadow-lg w-full max-w-md">
                        <div className="p-4 sm:p-6">
                            <h2 className="text-lg sm:text-xl font-bold mb-4">Request Cancellation</h2>
                            <div className="mb-4 p-3 bg-muted rounded">
                                <p className="font-medium">
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
                                    Your cancellation request will be sent to management for approval.
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
                                        className="btn-primary flex-1 bg-red-600 hover:bg-red-700"
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

            {/* Schedules List */}
            {loading ? (
                <div className="space-y-3 sm:space-y-4">
                    {[...Array(5)].map((_, i) => (
                        <div key={i} className="h-24 bg-muted rounded-lg animate-pulse"></div>
                    ))}
                </div>
            ) : schedules.length === 0 ? (
                <div className="card p-6 sm:p-8 text-center">
                    <p className="text-muted-foreground text-sm sm:text-base">
                        {filter === 'pending'
                            ? 'No schedules awaiting confirmation'
                            : filter === 'upcoming'
                                ? 'No upcoming schedules'
                                : 'No schedules found'}
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    {schedules.map((schedule) => {
                        const scheduleDate = new Date(schedule.schedule_date)
                        const isToday = schedule.schedule_date === new Date().toISOString().split('T')[0]
                        const isTomorrow = schedule.schedule_date === new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]

                        return (
                            <div
                                key={schedule.id}
                                className={`card p-4 ${isToday ? 'ring-2 ring-primary' : ''}`}
                            >
                                <div className="flex flex-col sm:flex-row justify-between gap-3">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-1">
                                            {isToday && (
                                                <span className="badge badge-default text-xs">Today</span>
                                            )}
                                            {isTomorrow && (
                                                <span className="badge badge-secondary text-xs">Tomorrow</span>
                                            )}
                                            <span className={`badge ${statusColors[schedule.status]}`}>
                                                {statusLabels[schedule.status]}
                                            </span>
                                        </div>
                                        <p className="font-medium">
                                            {scheduleDate.toLocaleDateString('en-US', {
                                                weekday: 'long',
                                                year: 'numeric',
                                                month: 'short',
                                                day: 'numeric',
                                            })}
                                        </p>
                                        <p className="text-lg font-semibold text-primary">
                                            {schedule.start_time} - {schedule.end_time}
                                        </p>
                                        {schedule.title && (
                                            <p className="text-sm font-medium mt-1">{schedule.title}</p>
                                        )}
                                        {schedule.location && (
                                            <p className="text-sm text-muted-foreground">
                                                Location: {schedule.location}
                                            </p>
                                        )}
                                        {schedule.description && (
                                            <p className="text-sm text-muted-foreground mt-1">
                                                {schedule.description}
                                            </p>
                                        )}
                                        {schedule.cancellation_reason && schedule.status === 'cancellation_requested' && (
                                            <p className="text-sm text-yellow-600 mt-2">
                                                Your reason: {schedule.cancellation_reason}
                                            </p>
                                        )}
                                        {schedule.confirmed_at && (
                                            <p className="text-xs text-muted-foreground mt-2">
                                                Confirmed on {new Date(schedule.confirmed_at).toLocaleString()}
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex gap-2 flex-shrink-0">
                                        {schedule.status === 'pending' && (
                                            <button
                                                className="btn-primary btn-sm"
                                                disabled={processing === schedule.id}
                                                onClick={() => handleConfirm(schedule.id)}
                                            >
                                                {processing === schedule.id ? 'Confirming...' : 'Confirm'}
                                            </button>
                                        )}
                                        {(schedule.status === 'pending' || schedule.status === 'confirmed') && (
                                            <button
                                                className="btn-secondary btn-sm text-red-600"
                                                onClick={() => openCancelModal(schedule)}
                                            >
                                                Request Cancel
                                            </button>
                                        )}
                                        {schedule.status === 'cancellation_requested' && (
                                            <span className="text-sm text-yellow-600">
                                                Awaiting approval...
                                            </span>
                                        )}
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
