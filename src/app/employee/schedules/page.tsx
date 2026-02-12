'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { createUntypedClient } from '@/lib/supabase/client'
import { ScheduleStatus } from '@/types/supabase'
import { scheduleNotifications } from '@/lib/notifications'
import { getTodayNY, getDateNY, formatScheduleDate, formatTimeString } from '@/lib/utils'
import { RichTextDisplay } from '@/components/RichTextEditor'
import useSWR from 'swr'

// PERFORMANCE: Create client once at module level
const supabase = createUntypedClient()

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

export default function EmployeeSchedulesPage() {
    const { user, employee, isLoading: authLoading } = useAuth()
    const [scheduleFilter, setScheduleFilter] = useState<'upcoming' | 'all' | 'pending'>('upcoming')
    const [processing, setProcessing] = useState<string | null>(null)
    const [showCancelModal, setShowCancelModal] = useState(false)
    const [cancellingSchedule, setCancellingSchedule] = useState<Schedule | null>(null)
    const [cancellationReason, setCancellationReason] = useState('')
    const [loadingTimeout, setLoadingTimeout] = useState(false)

    // Add timeout to prevent infinite loading state
    useEffect(() => {
        const timer = setTimeout(() => {
            if (authLoading) {
                setLoadingTimeout(true)
            }
        }, 5000) // 5 second timeout
        return () => clearTimeout(timer)
    }, [authLoading])

    // PERFORMANCE: Use SWR for schedules with caching
    const { data: schedules = [], mutate: mutateSchedules, isLoading: scheduleLoading } = useSWR(
        user?.id ? ['employee:schedules', user.id, scheduleFilter] : null,
        async () => {
            // Use New York timezone for date comparison
            const today = getTodayNY()
            let query = supabase
                .from('schedules')
                .select('*')
                .eq('employee_id', user!.id)
                .order('schedule_date', { ascending: true })
                .order('start_time', { ascending: true })

            if (scheduleFilter === 'upcoming') {
                query = query.gte('schedule_date', today).neq('status', 'cancelled')
            } else if (scheduleFilter === 'pending') {
                query = query.eq('status', 'pending')
            }

            const { data, error } = await query
            if (error) throw error
            return (data || []) as Schedule[]
        },
        {
            revalidateOnFocus: false,
            keepPreviousData: true,
            dedupingInterval: 30000,
        }
    )

    async function handleConfirm(scheduleId: string) {
        setProcessing(scheduleId)
        try {
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

            // Send email notification to managers (non-blocking)
            scheduleNotifications.confirmed(scheduleId).catch(console.error)

            alert('Schedule confirmed!')
            mutateSchedules()
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

            // Send email notification to managers (non-blocking)
            scheduleNotifications.cancellationRequested(cancellingSchedule.id, cancellationReason).catch(console.error)

            alert('Cancellation request submitted.')
            setShowCancelModal(false)
            setCancellingSchedule(null)
            setCancellationReason('')
            mutateSchedules()
        } catch (err: unknown) {
            const error = err as Error
            console.error('Error requesting cancellation:', error)
            alert('Error: ' + error.message)
        } finally {
            setProcessing(null)
        }
    }

    // Get shift info for display
    const shiftInfo = employee ? {
        type: employee.shift_type,
        start: employee.shift_start,
        end: employee.shift_end,
    } : null

    const pendingCount = schedules.filter(s => s.status === 'pending').length

    // Show loading state while auth is loading (with timeout to prevent infinite loading)
    if (authLoading && !loadingTimeout) {
        return (
            <div className="space-y-4 sm:space-y-6">
                <div className="h-12 bg-muted rounded-lg animate-pulse w-48"></div>
                <div className="h-10 bg-muted rounded-lg animate-pulse w-64"></div>
                <div className="space-y-3">
                    {[...Array(3)].map((_, i) => (
                        <div key={i} className="h-28 bg-muted rounded-xl animate-pulse"></div>
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
                    <h1 className="text-2xl sm:text-3xl font-bold">My Schedule</h1>
                    <p className="text-muted-foreground mt-1 text-sm sm:text-base">
                        View and manage your work schedules
                    </p>
                </div>
                {pendingCount > 0 && (
                    <div className="px-3 py-1 rounded-full bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300 text-sm font-medium">
                        {pendingCount} pending confirmation{pendingCount > 1 ? 's' : ''}
                    </div>
                )}
            </div>

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
                                {shiftInfo.start && shiftInfo.end && <span>{formatTimeString(shiftInfo.start)} - {formatTimeString(shiftInfo.end)}</span>}
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
            {scheduleLoading && !schedules.length ? (
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
                        // Use New York timezone for today/tomorrow comparison
                        const todayStr = getTodayNY()
                        const tomorrowStr = getDateNY(1)
                        const isToday = schedule.schedule_date === todayStr
                        const isTomorrow = schedule.schedule_date === tomorrowStr

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
                                            {formatScheduleDate(schedule.schedule_date)}
                                        </p>
                                        <p className="text-2xl font-bold text-primary mt-1">
                                            {formatTimeString(schedule.start_time)} - {formatTimeString(schedule.end_time)}
                                        </p>
                                        {schedule.title && (
                                            <p className="text-sm font-medium mt-2 text-muted-foreground">{schedule.title}</p>
                                        )}
                                        {schedule.description && (
                                            <div className="text-sm text-muted-foreground mt-1">
                                                <RichTextDisplay content={schedule.description} />
                                            </div>
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

            {/* Cancellation Request Modal */}
            {showCancelModal && cancellingSchedule && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-card rounded-xl shadow-xl w-full max-w-md border">
                        <div className="p-6">
                            <h2 className="text-xl font-bold mb-4">Request Cancellation</h2>
                            <div className="mb-4 p-4 bg-muted rounded-lg">
                                <p className="font-semibold">
                                    {formatScheduleDate(cancellingSchedule.schedule_date)}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                    {formatTimeString(cancellingSchedule.start_time)} - {formatTimeString(cancellingSchedule.end_time)}
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
