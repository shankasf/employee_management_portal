'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { createUntypedClient } from '@/lib/supabase/client'
import { formatTime, formatDateTime } from '@/lib/utils'

interface OpenAttendance {
    id: string
    clock_in: string
}

interface TodayTask {
    id: string
    task_id: string
    title: string
    description: string | null
    location: string | null
    status: string
    cutoff_time: string | null
    requires_photo: boolean
    requires_video: boolean
    requires_notes: boolean
}

interface UpcomingEvent {
    id: string
    title: string
    start_time: string
    end_time: string
    room: string | null
    my_role: string | null
}

interface PolicyStrip {
    id: string
    title: string
    content: string
    category: string | null
}

export default function EmployeeDashboard() {
    const { employee, user, isLoading: authLoading } = useAuth()
    const [clockedIn, setClockedIn] = useState<OpenAttendance | null>(null)
    const [tasks, setTasks] = useState<TodayTask[]>([])
    const [events, setEvents] = useState<UpcomingEvent[]>([])
    const [policies, setPolicies] = useState<PolicyStrip[]>([])
    const [loading, setLoading] = useState(true)
    const [clockLoading, setClockLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const loadData = useCallback(async () => {
        if (!user?.id) {
            setLoading(false)
            return
        }
        const supabase = createUntypedClient()

        // Set a timeout to prevent infinite loading
        const timeout = setTimeout(() => {
            console.warn('Dashboard load timeout - showing with available data')
            setLoading(false)
        }, 5000)

        try {
            // Check if clocked in - try RPC first, then fallback to direct query
            let clockedInData = null
            try {
                const { data: attendance, error: rpcError } = await supabase.rpc('get_open_attendance')
                if (rpcError) {
                    console.warn('RPC get_open_attendance error:', rpcError)
                    throw rpcError
                }
                if (attendance && attendance.length > 0) {
                    clockedInData = attendance[0]
                }
            } catch (err) {
                console.warn('RPC get_open_attendance failed, using direct query:', err)
                // Fallback: direct query with user filter
                const { data: attendanceData, error: queryError } = await supabase
                    .from('attendance_logs')
                    .select('id, clock_in')
                    .eq('employee_id', user.id)
                    .is('clock_out', null)
                    .order('clock_in', { ascending: false })
                    .limit(1)

                if (queryError) {
                    console.error('Direct attendance query error:', queryError)
                } else {
                    clockedInData = attendanceData?.[0] || null
                }
            }
            setClockedIn(clockedInData)

            // Get today's tasks - use direct query with user id
            try {
                const { data: tasksData } = await supabase.rpc('get_today_tasks')
                setTasks(tasksData || [])
            } catch (err) {
                console.warn('RPC get_today_tasks not available, using direct query:', err)
                // Fallback: direct query for today's tasks
                const today = new Date().toISOString().split('T')[0]
                const { data: tasksData } = await supabase
                    .from('task_instances')
                    .select(`
                        id,
                        task_id,
                        status,
                        tasks (
                            title,
                            description,
                            location,
                            cutoff_time,
                            requires_photo,
                            requires_video,
                            requires_notes
                        )
                    `)
                    .eq('employee_id', user.id)
                    .eq('scheduled_date', today)
                    .limit(10)

                const formattedTasks = (tasksData || []).map((t: unknown) => {
                    const task = t as { id: string; task_id: string; status: string; tasks: { title: string; description: string | null; location: string | null; cutoff_time: string | null; requires_photo: boolean; requires_video: boolean; requires_notes: boolean } | null }
                    return {
                        id: task.id,
                        task_id: task.task_id,
                        title: task.tasks?.title || 'Unknown Task',
                        description: task.tasks?.description || null,
                        location: task.tasks?.location || null,
                        status: task.status,
                        cutoff_time: task.tasks?.cutoff_time || null,
                        requires_photo: task.tasks?.requires_photo || false,
                        requires_video: task.tasks?.requires_video || false,
                        requires_notes: task.tasks?.requires_notes || false,
                    }
                })
                setTasks(formattedTasks)
            }

            // Get upcoming events - use direct query with user id
            try {
                const { data: eventsData } = await supabase.rpc('get_my_upcoming_events', { p_limit: 5 })
                setEvents(eventsData || [])
            } catch (err) {
                console.warn('RPC get_my_upcoming_events not available, using direct query:', err)
                // Fallback: direct query - get events user is assigned to
                const { data: assignmentsData } = await supabase
                    .from('event_staff_assignments')
                    .select(`
                        role,
                        events (
                            id,
                            title,
                            start_time,
                            end_time,
                            room
                        )
                    `)
                    .eq('employee_id', user.id)
                    .limit(5)

                const formattedEvents = (assignmentsData || [])
                    .filter((a: unknown) => {
                        const assignment = a as { events: { start_time: string } | null }
                        return assignment.events && new Date(assignment.events.start_time) >= new Date()
                    })
                    .map((a: unknown) => {
                        const assignment = a as { role: string | null; events: { id: string; title: string; start_time: string; end_time: string; room: string | null } }
                        return {
                            id: assignment.events.id,
                            title: assignment.events.title,
                            start_time: assignment.events.start_time,
                            end_time: assignment.events.end_time,
                            room: assignment.events.room,
                            my_role: assignment.role
                        }
                    })
                setEvents(formattedEvents)
            }

            // Get active policies
            const { data: policiesData } = await supabase
                .from('policy_strips')
                .select('*')
                .eq('is_active', true)
                .order('created_at', { ascending: false })
                .limit(5)
            setPolicies(policiesData || [])
            setError(null)
        } catch (err) {
            console.error('Error loading dashboard:', err)
            setError('Failed to load some dashboard data')
        } finally {
            clearTimeout(timeout)
            setLoading(false)
        }
    }, [user?.id])

    // Load data when user is available and auth is done loading
    useEffect(() => {
        if (!authLoading && user?.id) {
            loadData()
        } else if (!authLoading && !user) {
            setLoading(false)
        }
    }, [authLoading, user?.id, loadData])

    const handleClockIn = async () => {
        if (!user?.id) {
            alert('You must be logged in to clock in')
            return
        }
        setClockLoading(true)
        try {
            const supabase = createUntypedClient()

            // Check if already clocked in
            const { data: existing } = await supabase
                .from('attendance_logs')
                .select('id')
                .eq('employee_id', user.id)
                .is('clock_out', null)
                .limit(1)

            if (existing && existing.length > 0) {
                alert('You are already clocked in')
                await loadData()
                return
            }

            // Try RPC first, fallback to direct insert
            try {
                const { error } = await supabase.rpc('clock_in')
                if (error) throw error
            } catch (rpcErr) {
                console.warn('RPC clock_in not available, using direct insert:', rpcErr)
                const { error } = await supabase
                    .from('attendance_logs')
                    .insert({
                        employee_id: user.id,
                        clock_in: new Date().toISOString()
                    })
                if (error) throw error
            }

            await loadData()
        } catch (err) {
            console.error('Clock in error:', err)
            alert('Failed to clock in. Please try again.')
        } finally {
            setClockLoading(false)
        }
    }

    const handleClockOut = async () => {
        if (!user?.id || !clockedIn) {
            alert('You must be clocked in to clock out')
            return
        }
        setClockLoading(true)
        try {
            const supabase = createUntypedClient()
            const clockOutTime = new Date().toISOString()

            // Try RPC first, fallback to direct update
            let success = false
            try {
                const { error } = await supabase.rpc('clock_out')
                if (error) {
                    console.error('RPC clock_out error:', error)
                    throw error
                }
                success = true
            } catch (rpcErr) {
                console.warn('RPC clock_out failed, using direct update:', rpcErr)
            }

            // If RPC failed, use direct update
            if (!success) {
                const { data, error } = await supabase
                    .from('attendance_logs')
                    .update({
                        clock_out: clockOutTime,
                        total_hours: null // Let the trigger compute this
                    })
                    .eq('id', clockedIn.id)
                    .select()
                    .single()

                if (error) {
                    console.error('Direct update error:', error)
                    throw error
                }

                // If trigger didn't compute total_hours, calculate it manually
                if (data && data.clock_in && !data.total_hours) {
                    const clockInTime = new Date(data.clock_in).getTime()
                    const clockOutTimeMs = new Date(clockOutTime).getTime()
                    const totalHours = (clockOutTimeMs - clockInTime) / (1000 * 60 * 60)

                    await supabase
                        .from('attendance_logs')
                        .update({ total_hours: totalHours })
                        .eq('id', clockedIn.id)
                }
            }

            await loadData()
        } catch (err) {
            console.error('Clock out error:', err)
            const errorMessage = err instanceof Error ? err.message : 'Unknown error'
            alert(`Failed to clock out: ${errorMessage}`)
        } finally {
            setClockLoading(false)
        }
    }

    if (loading) {
        return (
            <div className="animate-pulse space-y-6">
                <div className="h-8 bg-muted rounded w-48"></div>
                <div className="h-40 bg-muted rounded-lg"></div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="h-64 bg-muted rounded-lg"></div>
                    <div className="h-64 bg-muted rounded-lg"></div>
                </div>
            </div>
        )
    }

    const pendingTasks = tasks.filter((t) => t.status === 'pending')

    return (
        <div className="space-y-4 sm:space-y-6">
            {error && (
                <div className="p-3 sm:p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg text-yellow-800 dark:text-yellow-200 text-sm">
                    ⚠️ {error}
                </div>
            )}
            <div>
                <h1 className="text-2xl sm:text-3xl font-bold">
                    Hello, {employee?.display_name || 'Team Member'}! 👋
                </h1>
                <p className="text-muted-foreground mt-1 text-sm sm:text-base">
                    {new Date().toLocaleDateString('en-US', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                    })}
                </p>
            </div>

            {/* Clock In/Out Card */}
            <div className="card">
                <div className="p-4 sm:p-6">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
                        <div>
                            <h2 className="text-base sm:text-lg font-semibold">Time Clock</h2>
                            {clockedIn ? (
                                <p className="text-muted-foreground text-sm">
                                    Clocked in at {formatTime(clockedIn.clock_in)}
                                </p>
                            ) : (
                                <p className="text-muted-foreground text-sm">You are not clocked in</p>
                            )}
                        </div>
                        <button
                            onClick={clockedIn ? handleClockOut : handleClockIn}
                            disabled={clockLoading}
                            className={`${clockedIn ? 'btn-destructive' : 'btn-primary'
                                } w-full sm:w-auto min-w-[120px] sm:min-w-[150px]`}
                        >
                            {clockLoading ? (
                                <span className="animate-spin">⏳</span>
                            ) : clockedIn ? (
                                <>🚪 Clock Out</>
                            ) : (
                                <>⏰ Clock In</>
                            )}
                        </button>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
                {/* Today's Tasks */}
                <div className="card">
                    <div className="card-header">
                        <h2 className="card-title text-base sm:text-lg flex items-center gap-2 flex-wrap">
                            ✅ Today&apos;s Tasks
                            <span className="badge-secondary text-xs">
                                {pendingTasks.length} pending
                            </span>
                        </h2>
                    </div>
                    <div className="card-content">
                        {tasks.length === 0 ? (
                            <p className="text-muted-foreground text-center py-4 text-sm">
                                No tasks assigned for today
                            </p>
                        ) : (
                            <div className="space-y-2 sm:space-y-3">
                                {tasks.slice(0, 5).map((task) => (
                                    <div
                                        key={task.id}
                                        className="flex items-start gap-2 sm:gap-3 p-2 sm:p-3 rounded-lg bg-muted/50"
                                    >
                                        <span
                                            className={`text-base sm:text-lg flex-shrink-0 ${task.status === 'completed' ? 'opacity-50' : ''
                                                }`}
                                        >
                                            {task.status === 'completed' ? '✅' : '⬜'}
                                        </span>
                                        <div className="flex-1 min-w-0">
                                            <p
                                                className={`font-medium text-sm ${task.status === 'completed' ? 'line-through opacity-50' : ''
                                                    }`}
                                            >
                                                {task.title}
                                            </p>
                                            {task.location && (
                                                <p className="text-xs text-muted-foreground truncate">
                                                    📍 {task.location}
                                                </p>
                                            )}
                                        </div>
                                        {task.cutoff_time && task.status !== 'completed' && (
                                            <span className="badge-warning text-xs flex-shrink-0">
                                                {task.cutoff_time}
                                            </span>
                                        )}
                                    </div>
                                ))}
                                {tasks.length > 5 && (
                                    <p className="text-xs sm:text-sm text-center text-muted-foreground">
                                        +{tasks.length - 5} more tasks
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Upcoming Events */}
                <div className="card">
                    <div className="card-header">
                        <h2 className="card-title text-base sm:text-lg flex items-center gap-2">
                            🎉 My Upcoming Events
                        </h2>
                    </div>
                    <div className="card-content">
                        {events.length === 0 ? (
                            <p className="text-muted-foreground text-center py-4 text-sm">
                                No upcoming events assigned
                            </p>
                        ) : (
                            <div className="space-y-2 sm:space-y-3">
                                {events.map((event) => (
                                    <div
                                        key={event.id}
                                        className="p-2 sm:p-3 rounded-lg bg-muted/50"
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0 flex-1">
                                                <p className="font-medium text-sm truncate">{event.title}</p>
                                                <p className="text-xs text-muted-foreground">
                                                    {formatDateTime(event.start_time)}
                                                </p>
                                                {event.room && (
                                                    <p className="text-xs text-muted-foreground truncate">
                                                        📍 {event.room}
                                                    </p>
                                                )}
                                            </div>
                                            {event.my_role && (
                                                <span className="badge-default text-xs flex-shrink-0">
                                                    {event.my_role}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Policy Messages */}
            {policies.length > 0 && (
                <div className="card">
                    <div className="card-header">
                        <h2 className="card-title text-base sm:text-lg flex items-center gap-2">
                            📋 Important Messages
                        </h2>
                    </div>
                    <div className="card-content">
                        <div className="space-y-2 sm:space-y-3">
                            {policies.map((policy) => (
                                <div
                                    key={policy.id}
                                    className="p-3 sm:p-4 rounded-lg border bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800"
                                >
                                    <div className="flex items-start gap-2 sm:gap-3">
                                        <span className="text-base sm:text-lg flex-shrink-0">📌</span>
                                        <div className="min-w-0 flex-1">
                                            <p className="font-medium text-blue-900 dark:text-blue-100 text-sm sm:text-base">
                                                {policy.title}
                                            </p>
                                            <p className="text-xs sm:text-sm text-blue-800 dark:text-blue-200 mt-1">
                                                {policy.content}
                                            </p>
                                            {policy.category && (
                                                <span className="badge-outline text-xs mt-2 inline-block">
                                                    {policy.category}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
