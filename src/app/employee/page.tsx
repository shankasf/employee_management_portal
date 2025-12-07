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
    const { employee } = useAuth()
    const [clockedIn, setClockedIn] = useState<OpenAttendance | null>(null)
    const [tasks, setTasks] = useState<TodayTask[]>([])
    const [events, setEvents] = useState<UpcomingEvent[]>([])
    const [policies, setPolicies] = useState<PolicyStrip[]>([])
    const [loading, setLoading] = useState(true)
    const [clockLoading, setClockLoading] = useState(false)

    const loadData = useCallback(async () => {
        const supabase = createUntypedClient()

        try {
            // Check if clocked in
            const { data: attendance } = await supabase.rpc('get_open_attendance')
            if (attendance && attendance.length > 0) {
                setClockedIn(attendance[0])
            } else {
                setClockedIn(null)
            }

            // Get today's tasks
            const { data: tasksData } = await supabase.rpc('get_today_tasks')
            setTasks(tasksData || [])

            // Get upcoming events
            const { data: eventsData } = await supabase.rpc('get_my_upcoming_events', { p_limit: 5 })
            setEvents(eventsData || [])

            // Get active policies
            const { data: policiesData } = await supabase
                .from('policy_strips')
                .select('*')
                .eq('is_active', true)
                .order('created_at', { ascending: false })
                .limit(5)
            setPolicies(policiesData || [])
        } catch (err) {
            console.error('Error loading dashboard:', err)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        loadData()
    }, [loadData])

    const handleClockIn = async () => {
        setClockLoading(true)
        try {
            const supabase = createUntypedClient()
            const { error } = await supabase.rpc('clock_in')
            if (error) throw error
            await loadData()
        } catch (err) {
            console.error('Clock in error:', err)
            alert('Failed to clock in. Please try again.')
        } finally {
            setClockLoading(false)
        }
    }

    const handleClockOut = async () => {
        setClockLoading(true)
        try {
            const supabase = createUntypedClient()
            const { error } = await supabase.rpc('clock_out')
            if (error) throw error
            await loadData()
        } catch (err) {
            console.error('Clock out error:', err)
            alert('Failed to clock out. Please try again.')
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
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold">
                    Hello, {employee?.display_name || 'Team Member'}! 👋
                </h1>
                <p className="text-muted-foreground mt-1">
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
                <div className="p-6">
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                        <div>
                            <h2 className="text-lg font-semibold">Time Clock</h2>
                            {clockedIn ? (
                                <p className="text-muted-foreground">
                                    Clocked in at {formatTime(clockedIn.clock_in)}
                                </p>
                            ) : (
                                <p className="text-muted-foreground">You are not clocked in</p>
                            )}
                        </div>
                        <button
                            onClick={clockedIn ? handleClockOut : handleClockIn}
                            disabled={clockLoading}
                            className={`${clockedIn ? 'btn-destructive' : 'btn-primary'
                                } min-w-[150px]`}
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

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Today's Tasks */}
                <div className="card">
                    <div className="card-header">
                        <h2 className="card-title text-lg flex items-center gap-2">
                            ✅ Today&apos;s Tasks
                            <span className="badge-secondary text-xs">
                                {pendingTasks.length} pending
                            </span>
                        </h2>
                    </div>
                    <div className="card-content">
                        {tasks.length === 0 ? (
                            <p className="text-muted-foreground text-center py-4">
                                No tasks assigned for today
                            </p>
                        ) : (
                            <div className="space-y-3">
                                {tasks.slice(0, 5).map((task) => (
                                    <div
                                        key={task.id}
                                        className="flex items-center gap-3 p-3 rounded-lg bg-muted/50"
                                    >
                                        <span
                                            className={`text-lg ${task.status === 'completed' ? 'opacity-50' : ''
                                                }`}
                                        >
                                            {task.status === 'completed' ? '✅' : '⬜'}
                                        </span>
                                        <div className="flex-1 min-w-0">
                                            <p
                                                className={`font-medium ${task.status === 'completed' ? 'line-through opacity-50' : ''
                                                    }`}
                                            >
                                                {task.title}
                                            </p>
                                            {task.location && (
                                                <p className="text-xs text-muted-foreground">
                                                    📍 {task.location}
                                                </p>
                                            )}
                                        </div>
                                        {task.cutoff_time && task.status !== 'completed' && (
                                            <span className="badge-warning text-xs">
                                                Due by {task.cutoff_time}
                                            </span>
                                        )}
                                    </div>
                                ))}
                                {tasks.length > 5 && (
                                    <p className="text-sm text-center text-muted-foreground">
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
                        <h2 className="card-title text-lg flex items-center gap-2">
                            🎉 My Upcoming Events
                        </h2>
                    </div>
                    <div className="card-content">
                        {events.length === 0 ? (
                            <p className="text-muted-foreground text-center py-4">
                                No upcoming events assigned
                            </p>
                        ) : (
                            <div className="space-y-3">
                                {events.map((event) => (
                                    <div
                                        key={event.id}
                                        className="p-3 rounded-lg bg-muted/50"
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <div>
                                                <p className="font-medium">{event.title}</p>
                                                <p className="text-xs text-muted-foreground">
                                                    {formatDateTime(event.start_time)}
                                                </p>
                                                {event.room && (
                                                    <p className="text-xs text-muted-foreground">
                                                        📍 {event.room}
                                                    </p>
                                                )}
                                            </div>
                                            {event.my_role && (
                                                <span className="badge-default text-xs">
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
                        <h2 className="card-title text-lg flex items-center gap-2">
                            📋 Important Messages
                        </h2>
                    </div>
                    <div className="card-content">
                        <div className="space-y-3">
                            {policies.map((policy) => (
                                <div
                                    key={policy.id}
                                    className="p-4 rounded-lg border bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800"
                                >
                                    <div className="flex items-start gap-3">
                                        <span className="text-lg">📌</span>
                                        <div>
                                            <p className="font-medium text-blue-900 dark:text-blue-100">
                                                {policy.title}
                                            </p>
                                            <p className="text-sm text-blue-800 dark:text-blue-200 mt-1">
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
