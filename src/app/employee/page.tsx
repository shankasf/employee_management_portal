'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { createUntypedClient } from '@/lib/supabase/client'
import { formatTime, formatDateTime } from '@/lib/utils'
import { getDeviceInfo, formatDeviceDisplay } from '@/lib/device'
import {
    useOpenAttendance,
    useTodayTasks,
    useMyUpcomingEvents,
    useActivePolicies,
    invalidateQueries
} from '@/lib/hooks/useData'
import useSWR from 'swr'

interface Task {
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

interface Event {
    id: string
    title: string
    start_time: string
    end_time: string
    room: string | null
    my_role: string | null
}

interface Policy {
    id: string
    title: string
    content: string
    category: string | null
}

export default function EmployeeDashboard() {
    const { employee, user, isLoading: authLoading } = useAuth()
    const [clockLoading, setClockLoading] = useState(false)

    // Device registration state
    const [showDevicePrompt, setShowDevicePrompt] = useState(false)
    const [deviceRegistering, setDeviceRegistering] = useState(false)
    const [currentDeviceInfo, setCurrentDeviceInfo] = useState<{ deviceId: string; deviceName: string } | null>(null)

    // Use SWR hooks for cached, instant data on refresh
    const { data: clockedIn, mutate: mutateAttendance } = useOpenAttendance(user?.id)
    const { data: rawTasks } = useTodayTasks(user?.id)
    const { data: rawEvents } = useMyUpcomingEvents(user?.id)
    const { data: rawPolicies } = useActivePolicies()

    // Type the data with defaults
    const tasks: Task[] = (rawTasks || []) as Task[]
    const events: Event[] = (rawEvents || []) as Event[]
    const policies: Policy[] = (rawPolicies || []) as Policy[]

    // Fetch device info with SWR for caching
    const { data: deviceData } = useSWR(
        user?.id ? ['employee:device', user.id] : null,
        async () => {
            const supabase = createUntypedClient()
            const { data } = await supabase
                .from('employees')
                .select('registered_device_id, device_name')
                .eq('id', user!.id)
                .single()
            return data
        },
        { revalidateOnFocus: false, dedupingInterval: 30000 }
    )

    const registeredDeviceId = deviceData?.registered_device_id || null
    const registeredDeviceName = deviceData?.device_name || null
    const deviceMismatch = currentDeviceInfo && registeredDeviceId
        ? registeredDeviceId !== currentDeviceInfo.deviceId
        : false

    // Get current device info on mount
    useEffect(() => {
        const info = getDeviceInfo()
        setCurrentDeviceInfo(info)
    }, [])

    // Register device for this employee
    const handleRegisterDevice = useCallback(async () => {
        if (!user?.id || !currentDeviceInfo) return

        setDeviceRegistering(true)
        try {
            const supabase = createUntypedClient()
            const { error } = await supabase.rpc('register_device', {
                p_device_id: currentDeviceInfo.deviceId,
                p_device_name: currentDeviceInfo.deviceName
            })

            if (error) throw error

            // Invalidate device cache
            invalidateQueries.all()
            setShowDevicePrompt(false)
        } catch (err) {
            console.error('Device registration error:', err)
            alert('Failed to register device. Please try again.')
        } finally {
            setDeviceRegistering(false)
        }
    }, [user?.id, currentDeviceInfo])

    // Handle clock in with device verification
    const handleClockIn = async () => {
        if (!user?.id) {
            alert('You must be logged in to clock in')
            return
        }

        if (!currentDeviceInfo) {
            alert('Unable to identify your device. Please refresh the page.')
            return
        }

        // If no device is registered, prompt to register this device
        if (!registeredDeviceId) {
            setShowDevicePrompt(true)
            return
        }

        // Check if current device matches registered device
        if (registeredDeviceId !== currentDeviceInfo.deviceId) {
            alert('You can only clock in from your registered device. Please use your registered device or contact admin to update your device.')
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
                mutateAttendance()
                return
            }

            // Insert with device data
            const { error } = await supabase
                .from('attendance_logs')
                .insert({
                    employee_id: user.id,
                    clock_in: new Date().toISOString(),
                    clock_in_device_id: currentDeviceInfo.deviceId,
                    clock_in_device_name: currentDeviceInfo.deviceName,
                })
            if (error) throw error

            mutateAttendance()
        } catch (err) {
            console.error('Clock in error:', err)
            alert('Failed to clock in. Please try again.')
        } finally {
            setClockLoading(false)
        }
    }

    // Handle clock out with device verification
    const handleClockOut = async () => {
        if (!user?.id || !clockedIn) {
            alert('You must be clocked in to clock out')
            return
        }

        if (!currentDeviceInfo) {
            alert('Unable to identify your device. Please refresh the page.')
            return
        }

        setClockLoading(true)

        try {
            const supabase = createUntypedClient()
            const clockOutTime = new Date().toISOString()

            // Direct update with device data
            const { data, error } = await supabase
                .from('attendance_logs')
                .update({
                    clock_out: clockOutTime,
                    clock_out_device_id: currentDeviceInfo.deviceId,
                    clock_out_device_name: currentDeviceInfo.deviceName,
                    total_hours: null
                })
                .eq('id', clockedIn.id)
                .select()
                .single()

            if (error) {
                console.error('Clock out error:', error)
                throw error
            }

            // Calculate total_hours if trigger didn't
            if (data && data.clock_in && !data.total_hours) {
                const clockInTime = new Date(data.clock_in).getTime()
                const clockOutTimeMs = new Date(clockOutTime).getTime()
                const totalHours = (clockOutTimeMs - clockInTime) / (1000 * 60 * 60)

                await supabase
                    .from('attendance_logs')
                    .update({ total_hours: totalHours })
                    .eq('id', clockedIn.id)
            }

            mutateAttendance()
        } catch (err) {
            console.error('Clock out error:', err)
            const errorMessage = err instanceof Error ? err.message : 'Unknown error'
            alert(`Failed to clock out: ${errorMessage}`)
        } finally {
            setClockLoading(false)
        }
    }

    // Show loading only on initial auth load
    if (authLoading) {
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
            {/* Device Registration Modal */}
            {showDevicePrompt && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-card rounded-xl shadow-xl w-full max-w-md border">
                        <div className="p-6">
                            <div className="text-center mb-6">
                                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                                    <svg className="w-8 h-8 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                    </svg>
                                </div>
                                <h2 className="text-xl font-bold mb-2">Register This Device</h2>
                                <p className="text-muted-foreground text-sm">
                                    To clock in, you need to register this device. Once registered, you can only clock in from this device.
                                </p>
                            </div>

                            {/* Device info */}
                            <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                                <p className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-1">
                                    Device Details
                                </p>
                                <p className="text-xs text-blue-700 dark:text-blue-300">
                                    {currentDeviceInfo?.deviceName || 'Unknown Device'}
                                </p>
                                <p className="text-xs text-blue-600 dark:text-blue-400 font-mono mt-1">
                                    ID: {currentDeviceInfo?.deviceId?.slice(-12) || 'N/A'}
                                </p>
                            </div>

                            <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                                <p className="text-xs text-yellow-800 dark:text-yellow-200">
                                    <strong>Important:</strong> After registering, you will only be able to clock in from this specific device/browser. Contact your admin if you need to change devices.
                                </p>
                            </div>

                            <div className="space-y-3">
                                <button
                                    onClick={handleRegisterDevice}
                                    disabled={deviceRegistering}
                                    className="btn-primary w-full flex items-center justify-center gap-2"
                                >
                                    {deviceRegistering ? (
                                        <>
                                            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                            </svg>
                                            Registering...
                                        </>
                                    ) : (
                                        <>
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                            Register This Device
                                        </>
                                    )}
                                </button>

                                <button
                                    onClick={() => setShowDevicePrompt(false)}
                                    className="btn-secondary w-full"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
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
                            {/* Device Status Indicator */}
                            {registeredDeviceId && (
                                <p className={`text-xs mt-1 ${deviceMismatch ? 'text-red-600' : 'text-green-600'}`}>
                                    {deviceMismatch ? (
                                        <>🚫 Wrong device - use {formatDeviceDisplay(registeredDeviceName, registeredDeviceId)}</>
                                    ) : (
                                        <>✓ Registered device: {formatDeviceDisplay(registeredDeviceName, registeredDeviceId)}</>
                                    )}
                                </p>
                            )}
                            {!registeredDeviceId && (
                                <p className="text-xs mt-1 text-yellow-600">
                                    ⚠️ No device registered - click Clock In to register
                                </p>
                            )}
                        </div>
                        <div className="flex flex-col gap-2 w-full sm:w-auto">
                            <button
                                onClick={clockedIn ? handleClockOut : handleClockIn}
                                disabled={clockLoading || (!clockedIn && deviceMismatch)}
                                className={`${clockedIn ? 'btn-destructive' : 'btn-primary'
                                    } w-full sm:w-auto min-w-[120px] sm:min-w-[150px] flex items-center justify-center gap-2 ${
                                    !clockedIn && deviceMismatch ? 'opacity-50 cursor-not-allowed' : ''
                                    }`}
                            >
                                {clockLoading ? (
                                    <>
                                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                        </svg>
                                        {clockedIn ? 'Clocking Out...' : 'Clocking In...'}
                                    </>
                                ) : clockedIn ? (
                                    <>🚪 Clock Out</>
                                ) : (
                                    <>⏰ Clock In</>
                                )}
                            </button>
                            {/* Device mismatch hint */}
                            {deviceMismatch && !clockedIn && (
                                <p className="text-xs text-red-600 dark:text-red-400 text-center">
                                    You can only clock in from your registered device.
                                </p>
                            )}
                        </div>
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
