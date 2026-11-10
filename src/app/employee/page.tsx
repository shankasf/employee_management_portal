'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { createUntypedClient } from '@/lib/supabase/client'
import { formatDateTime, formatTimeString, getTodayNY, getNYOffsetStr } from '@/lib/utils'
import { RichTextDisplay } from '@/components/RichTextEditor'
import DeviceResetModal from '@/components/DeviceResetModal'
import { getDeviceInfo, formatDeviceDisplay } from '@/lib/device'
import { captureLocation } from '@/lib/geolocation'
import { logClockDebug } from '@/lib/clock-debug-log'
import {
    useEmployeeDashboard,
    useOpenAttendance,
    useTodayTasks,
    useMyUpcomingEvents,
    useActivePolicies,
    invalidateQueries
} from '@/lib/hooks/useData'
import useSWR from 'swr'
import NavIcon from '@/components/pwa/NavIcon'
import { logPageView, logButtonClick } from '@/lib/usage-log'
import PushReminderPrompt from '@/components/pwa/PushReminderPrompt'
import type { PushStatus } from '@/lib/push-client'

interface OpenAttendance {
    id: string
    clock_in: string
    break_start?: string | null
    break_minutes?: number | null
}

interface PendingTrainingItem {
    id: string
    business_id: number
    business_name: string
    type: string
    subtype: string | null
    title: string
}

interface PendingTrainingSummary {
    new_count: number
    in_progress_count: number
    total_pending: number
    items: PendingTrainingItem[]
}

function trainingIcon(item: PendingTrainingItem): string {
    if (item.type === 'video' || item.subtype === 'video') return '🎥'
    if (item.subtype === 'pdf') return '📄'
    if (item.subtype === 'image') return '🖼️'
    if (item.subtype === 'audio') return '🎧'
    if (item.subtype === 'docx') return '📑'
    if (item.type === 'document') return '📄'
    if (item.type === 'article') return '📝'
    return '📚'
}

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
    const [loadingTimeout, setLoadingTimeout] = useState(false)

    // Device registration state
    const [showDevicePrompt, setShowDevicePrompt] = useState(false)
    const [showDeviceReset, setShowDeviceReset] = useState(false)
    const [deviceRegistering, setDeviceRegistering] = useState(false)
    const [currentDeviceInfo, setCurrentDeviceInfo] = useState<{ deviceId: string; deviceName: string } | null>(null)

    // Lunch (break) state
    const [lunchLoading, setLunchLoading] = useState(false)
    const [nowTick, setNowTick] = useState(() => Date.now())
    const [pushStatus, setPushStatus] = useState<PushStatus>('loading')

    // Pending tasks reminder state
    const [showPendingTasksModal, setShowPendingTasksModal] = useState(false)
    const [pendingTaskReminderSending, setPendingTaskReminderSending] = useState(false)

    // Log page view
    useEffect(() => {
        logPageView('Employee Dashboard', 'attendance')
    }, [])

    // Add timeout to prevent infinite loading state
    useEffect(() => {
        const timer = setTimeout(() => {
            if (authLoading) {
                setLoadingTimeout(true)
            }
        }, 5000) // 5 second timeout
        return () => clearTimeout(timer)
    }, [authLoading])

    // Try combined dashboard hook first (1 query), fallback to individual hooks if RPC not available
    const { data: dashboard, mutate: mutateDashboard, isLoading: dashboardLoading } = useEmployeeDashboard(user?.id)

    // PERFORMANCE: Determine if we need fallback BEFORE calling hooks
    // Only fetch fallback data when RPC explicitly returned null (not during loading)
    const useFallback = !dashboardLoading && dashboard === null

    // PERFORMANCE: Conditionally enable fallback hooks - pass null key to disable SWR fetch
    // This prevents 4 extra queries when the combined RPC works
    const fallbackKey = useFallback ? user?.id : undefined
    const { data: fallbackAttendance, mutate: mutateFallbackAttendance } = useOpenAttendance(fallbackKey)
    const { data: fallbackTasks } = useTodayTasks(fallbackKey)
    const { data: fallbackEvents } = useMyUpcomingEvents(fallbackKey)
    const { data: fallbackPolicies } = useActivePolicies() // Always fetch - used as fallback for dashboard too

    // Fetch pending training summary so we can surface newly assigned
    // training videos / documents on the dashboard. Shares an SWR key with
    // the layout's nav badge so a single request serves both.
    const { data: pendingTraining } = useSWR<PendingTrainingSummary>(
        user?.id ? ['employee:onboarding:pending', user.id] : null,
        async () => {
            const res = await fetch('/api/onboarding/pending', { credentials: 'include' })
            if (!res.ok) throw new Error('Failed to load training')
            return res.json()
        },
        {
            refreshInterval: 30000,
            revalidateOnFocus: true,
            revalidateOnReconnect: true,
            dedupingInterval: 15000,
        }
    )

    // Fetch device info with SWR for caching (fallback)
    const { data: fallbackDeviceData } = useSWR(
        useFallback && user?.id ? ['employee:device', user.id] : null,
        async () => {
            const supabase = createUntypedClient()
            const { data } = await supabase
                .from('employees')
                .select('registered_device_id, device_name')
                .eq('id', user!.id)
                .single()
            return data
        },
        { revalidateOnFocus: false, dedupingInterval: 60000 }
    )

    // Use combined data if available, otherwise use fallback
    const clockedIn = useFallback
        ? fallbackAttendance as OpenAttendance | null
        : dashboard?.open_attendance as OpenAttendance | null
    const onLunch = !!clockedIn?.break_start
    const tasks: Task[] = useFallback
        ? (fallbackTasks || []) as Task[]
        : (dashboard?.today_tasks || []) as Task[]
    const events: Event[] = useFallback
        ? (fallbackEvents || []) as Event[]
        : (dashboard?.upcoming_events || []) as Event[]
    // Policies: use from dashboard if available, otherwise from fallback (which always fetches)
    const policies: Policy[] = (dashboard?.active_policies || fallbackPolicies || []) as Policy[]
    const deviceData = useFallback
        ? fallbackDeviceData as { registered_device_id: string | null; device_name: string | null } | null
        : dashboard?.device_info as { registered_device_id: string | null; device_name: string | null } | null

    // Mutate function for attendance updates
    const mutateAttendance = useFallback ? mutateFallbackAttendance : mutateDashboard

    // Read receipts for important messages — fetch IDs the current employee
    // has already acknowledged so we can render them as read.
    const { data: readPolicyIds, mutate: mutateReads } = useSWR<string[]>(
        user?.id ? ['employee:policies:reads', user.id] : null,
        async () => {
            const supabase = createUntypedClient()
            const { data, error } = await supabase
                .from('policy_strip_reads')
                .select('policy_strip_id')
                .eq('employee_id', user!.id)
            if (error) throw error
            return ((data || []) as Array<{ policy_strip_id: string }>).map(r => r.policy_strip_id)
        },
        { revalidateOnFocus: true, dedupingInterval: 15000 }
    )
    const readPolicySet = new Set<string>(readPolicyIds || [])
    const [markingReadId, setMarkingReadId] = useState<string | null>(null)

    const markPolicyRead = async (policyId: string) => {
        setMarkingReadId(policyId)
        // Optimistic update
        mutateReads([...(readPolicyIds || []), policyId], false)
        try {
            const res = await fetch('/api/policies/read', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ policy_id: policyId }),
                credentials: 'include',
            })
            if (!res.ok) throw new Error('Failed')
            mutateReads()
        } catch {
            mutateReads()
            alert('Failed to mark as read. Please try again.')
        } finally {
            setMarkingReadId(null)
        }
    }

    const registeredDeviceId = deviceData?.registered_device_id || null
    const registeredDeviceName = deviceData?.device_name || null
    const deviceMismatch = currentDeviceInfo && registeredDeviceId
        ? registeredDeviceId !== currentDeviceInfo.deviceId
        : false

    // Get current device info when user is available
    useEffect(() => {
        if (!user?.id) return
        let stale = false
        getDeviceInfo(user.id).then((info) => {
            if (!stale) setCurrentDeviceInfo(info)
        })
        return () => { stale = true }
    }, [user?.id])

    // Register device for this employee
    const handleRegisterDevice = useCallback(async () => {
        if (!user?.id || !currentDeviceInfo) return

        logClockDebug('device_registration', 'device_register_start', 'info', 'Starting device registration', {
            deviceId: currentDeviceInfo.deviceId,
            deviceName: currentDeviceInfo.deviceName,
        }, currentDeviceInfo)

        setDeviceRegistering(true)
        try {
            const supabase = createUntypedClient()
            const { error } = await supabase.rpc('register_device', {
                p_device_id: currentDeviceInfo.deviceId,
                p_device_name: currentDeviceInfo.deviceName
            })

            if (error) {
                logClockDebug('device_registration', 'device_register', 'fail', `Device registration failed: ${error.message}`, {
                    errorCode: error.code,
                    errorMessage: error.message,
                }, currentDeviceInfo)
                throw error
            }

            logClockDebug('device_registration', 'device_register', 'pass', 'Device registered successfully', {
                deviceId: currentDeviceInfo.deviceId,
            }, currentDeviceInfo)

            // Invalidate device cache
            invalidateQueries.all()
            setShowDevicePrompt(false)
        } catch (err) {
            console.error('Device registration error:', err)
            const errorMessage = err instanceof Error ? err.message :
                (err as { message?: string })?.message || 'Unknown error'
            alert(`Failed to register device: ${errorMessage}`)
        } finally {
            setDeviceRegistering(false)
        }
    }, [user?.id, currentDeviceInfo])

    // Handle clock in with device verification
    const handleClockIn = async () => {
        // Step 1: Auth check
        if (!user?.id) {
            logClockDebug('clock_in', 'auth_check', 'fail', 'User not logged in')
            alert('You must be logged in to clock in')
            return
        }
        logClockDebug('clock_in', 'auth_check', 'pass', 'User authenticated', { userId: user.id }, currentDeviceInfo)

        // Step 2: Device detection
        if (!currentDeviceInfo) {
            logClockDebug('device_registration', 'device_detection', 'fail', 'Unable to detect device info')
            alert('Unable to identify your device. Please refresh the page.')
            return
        }
        logClockDebug('device_registration', 'device_detection', 'pass', 'Device detected', {
            deviceId: currentDeviceInfo.deviceId,
            deviceName: currentDeviceInfo.deviceName,
        }, currentDeviceInfo)

        // Step 3: Device registered check
        if (!registeredDeviceId) {
            logClockDebug('device_registration', 'device_registered', 'fail', 'No device registered — prompting registration', {
                currentDeviceId: currentDeviceInfo.deviceId,
            }, currentDeviceInfo)
            setShowDevicePrompt(true)
            return
        }
        logClockDebug('device_registration', 'device_registered', 'pass', 'Device is registered', {
            registeredDeviceId,
            registeredDeviceName: registeredDeviceName,
        }, currentDeviceInfo)

        // Step 4: Device match
        if (registeredDeviceId !== currentDeviceInfo.deviceId) {
            logClockDebug('device_registration', 'device_match', 'fail', 'Device mismatch', {
                registeredDeviceId,
                currentDeviceId: currentDeviceInfo.deviceId,
                registeredDeviceName,
                currentDeviceName: currentDeviceInfo.deviceName,
            }, currentDeviceInfo)
            alert('You can only clock in from your registered device. Please use your registered device or contact admin to update your device.')
            return
        }
        logClockDebug('device_registration', 'device_match', 'pass', 'Device matches registered device', {
            deviceId: currentDeviceInfo.deviceId,
        }, currentDeviceInfo)

        setClockLoading(true)

        try {
            const supabase = createUntypedClient()

            // Step 5: Already clocked in check
            const { data: existing } = await supabase
                .from('attendance_logs')
                .select('id')
                .eq('employee_id', user.id)
                .is('clock_out', null)
                .limit(1)

            if (existing && existing.length > 0) {
                logClockDebug('clock_in', 'already_clocked_in', 'fail', 'Already clocked in', {
                    existingAttendanceId: existing[0].id,
                }, currentDeviceInfo)
                alert('You are already clocked in')
                mutateAttendance()
                return
            }
            logClockDebug('clock_in', 'already_clocked_in', 'pass', 'Not currently clocked in', undefined, currentDeviceInfo)

            // Step 6: GPS capture
            const location = await captureLocation()
            logClockDebug('clock_in', 'gps_capture', 'info', `GPS: ${location.status}`, {
                status: location.status,
                lat: location.lat,
                lng: location.lng,
                accuracy: location.accuracy,
            }, currentDeviceInfo)

            // Step 7: DB insert
            const { error } = await supabase
                .from('attendance_logs')
                .insert({
                    employee_id: user.id,
                    clock_in: new Date().toISOString(),
                    clock_in_device_id: currentDeviceInfo.deviceId,
                    clock_in_device_name: currentDeviceInfo.deviceName,
                    clock_in_lat: location.lat,
                    clock_in_lng: location.lng,
                    clock_in_accuracy: location.accuracy,
                    clock_in_location_status: location.status,
                })

            if (error) {
                logClockDebug('clock_in', 'db_insert', 'fail', `DB insert failed: ${error.message}`, {
                    errorCode: error.code,
                    errorMessage: error.message,
                    errorDetails: error.details,
                }, currentDeviceInfo)
                throw error
            }
            logClockDebug('clock_in', 'db_insert', 'pass', 'Attendance record created', undefined, currentDeviceInfo)

            // Log clock in action
            logButtonClick('Clock In', 'attendance', { deviceId: currentDeviceInfo.deviceId })

            logClockDebug('clock_in', 'complete', 'success', 'Clock in completed successfully', undefined, currentDeviceInfo)

            mutateAttendance()
        } catch (err) {
            console.error('Clock in error:', err)
            logClockDebug('clock_in', 'error', 'fail', `Clock in error: ${err instanceof Error ? err.message : 'Unknown error'}`, {
                error: err instanceof Error ? err.message : String(err),
            }, currentDeviceInfo)
            alert('Failed to clock in. Please try again.')
        } finally {
            setClockLoading(false)
        }
    }

    // Perform the actual clock out (extracted so modal can call it too)
    const performClockOut = async () => {
        // Step 1: Auth check
        if (!user?.id || !clockedIn) {
            logClockDebug('clock_out', 'auth_check', 'fail', 'User not clocked in or not logged in', {
                hasUser: !!user?.id,
                hasClockedIn: !!clockedIn,
            })
            alert('You must be clocked in to clock out')
            return
        }
        logClockDebug('clock_out', 'auth_check', 'pass', 'User authenticated and clocked in', {
            userId: user.id,
            attendanceId: clockedIn.id,
        }, currentDeviceInfo)

        // Step 2: Device detection
        if (!currentDeviceInfo) {
            logClockDebug('device_registration', 'device_detection', 'fail', 'Unable to detect device info')
            alert('Unable to identify your device. Please refresh the page.')
            return
        }
        logClockDebug('device_registration', 'device_detection', 'pass', 'Device detected', {
            deviceId: currentDeviceInfo.deviceId,
            deviceName: currentDeviceInfo.deviceName,
        }, currentDeviceInfo)

        setClockLoading(true)

        try {
            const supabase = createUntypedClient()
            const actualClockOutTime = new Date()
            const actualClockOutISO = actualClockOutTime.toISOString()

            // Step 3: GPS capture
            const location = await captureLocation()
            logClockDebug('clock_out', 'gps_capture', 'info', `GPS: ${location.status}`, {
                status: location.status,
                lat: location.lat,
                lng: location.lng,
                accuracy: location.accuracy,
            }, currentDeviceInfo)

            // Step 4: Schedule lookup
            const todayNY = getTodayNY()
            let effectiveClockOut = actualClockOutISO
            let lateClockOutMinutes: number | null = null
            let actualClockOutValue: string | null = null

            const { data: schedules } = await supabase
                .from('schedules')
                .select('schedule_date, end_time')
                .eq('employee_id', user.id)
                .eq('schedule_date', todayNY)
                .neq('status', 'cancelled')
                .order('start_time', { ascending: true })

            logClockDebug('clock_out', 'schedule_lookup', 'info',
                schedules && schedules.length > 0
                    ? `Found ${schedules.length} schedule(s) for today`
                    : 'No schedules found for today',
                {
                    todayNY,
                    scheduleCount: schedules?.length || 0,
                    schedules: schedules?.map((s: { schedule_date: string; end_time: string | null }) => ({ date: s.schedule_date, endTime: s.end_time })),
                }, currentDeviceInfo)

            if (schedules && schedules.length > 0) {
                // Use the last schedule (latest end_time)
                const lastSchedule = schedules[schedules.length - 1]
                if (lastSchedule.end_time) {
                    const offsetStr = getNYOffsetStr(todayNY)
                    const scheduledEndUTC = new Date(`${todayNY}T${lastSchedule.end_time}${offsetStr}`)

                    if (actualClockOutTime.getTime() > scheduledEndUTC.getTime()) {
                        // Employee clocked out late — cap at scheduled end time
                        effectiveClockOut = scheduledEndUTC.toISOString()
                        actualClockOutValue = actualClockOutISO
                        lateClockOutMinutes = Math.ceil(
                            (actualClockOutTime.getTime() - scheduledEndUTC.getTime()) / 60000
                        )

                        // Step 4b: Late checkout info
                        logClockDebug('clock_out', 'late_checkout', 'info', `Late by ${lateClockOutMinutes} min — capped at scheduled end`, {
                            scheduledEnd: scheduledEndUTC.toISOString(),
                            actualClockOut: actualClockOutISO,
                            effectiveClockOut,
                            lateMinutes: lateClockOutMinutes,
                        }, currentDeviceInfo)
                    }
                }
            }

            // Step 5: DB update. An open lunch is closed in the same write so
            // the hours trigger subtracts it and no break_start is left behind.
            const breakClose: { break_start?: null; break_minutes?: number; break_reminder_sent_at?: null } = {}
            if (clockedIn.break_start) {
                const lunchMinutes = Math.max(1, Math.round((actualClockOutTime.getTime() - new Date(clockedIn.break_start).getTime()) / 60000))
                breakClose.break_start = null
                breakClose.break_reminder_sent_at = null
                breakClose.break_minutes = (clockedIn.break_minutes || 0) + lunchMinutes
                logClockDebug('clock_out', 'lunch_close', 'info', `Closing open lunch: ${lunchMinutes} min`, {
                    breakStart: clockedIn.break_start,
                    lunchMinutes,
                }, currentDeviceInfo)
            }

            const { data, error } = await supabase
                .from('attendance_logs')
                .update({
                    ...breakClose,
                    clock_out: effectiveClockOut,
                    actual_clock_out: actualClockOutValue,
                    late_clock_out_minutes: lateClockOutMinutes,
                    clock_out_device_id: currentDeviceInfo.deviceId,
                    clock_out_device_name: currentDeviceInfo.deviceName,
                    clock_out_lat: location.lat,
                    clock_out_lng: location.lng,
                    clock_out_accuracy: location.accuracy,
                    clock_out_location_status: location.status,
                    total_hours: null
                })
                .eq('id', clockedIn.id)
                .select()
                .single()

            if (error) {
                console.error('Clock out error:', error)
                logClockDebug('clock_out', 'db_update', 'fail', `DB update failed: ${error.message}`, {
                    errorCode: error.code,
                    errorMessage: error.message,
                    errorDetails: error.details,
                    attendanceId: clockedIn.id,
                }, currentDeviceInfo)
                throw error
            }
            logClockDebug('clock_out', 'db_update', 'pass', 'Attendance record updated', {
                attendanceId: clockedIn.id,
                effectiveClockOut,
            }, currentDeviceInfo)

            // Step 6: Hours calculation fallback (only when the DB trigger left it
            // null; a legitimate 0 must not be overwritten). Subtract lunch and
            // never go below zero, matching compute_total_hours().
            if (data && data.clock_in && (data.total_hours === null || data.total_hours === undefined)) {
                const clockInTime = new Date(data.clock_in).getTime()
                const clockOutTimeMs = new Date(effectiveClockOut).getTime()
                const breakMins = data.break_minutes || 0
                const totalHours = Math.round(Math.max(0, (clockOutTimeMs - clockInTime) / (1000 * 60 * 60) - breakMins / 60) * 100) / 100

                logClockDebug('clock_out', 'hours_calc', 'info', `Fallback hours calc: ${totalHours.toFixed(2)}h (break: ${breakMins}m)`, {
                    clockIn: data.clock_in,
                    clockOut: effectiveClockOut,
                    breakMins,
                    totalHours,
                }, currentDeviceInfo)

                await supabase
                    .from('attendance_logs')
                    .update({ total_hours: totalHours })
                    .eq('id', clockedIn.id)
            }

            // Log clock out action
            logButtonClick('Clock Out', 'attendance', { deviceId: currentDeviceInfo.deviceId })

            logClockDebug('clock_out', 'complete', 'success', 'Clock out completed successfully', undefined, currentDeviceInfo)

            mutateAttendance()
        } catch (err) {
            console.error('Clock out error:', err)
            logClockDebug('clock_out', 'error', 'fail', `Clock out error: ${err instanceof Error ? err.message : 'Unknown error'}`, {
                error: err instanceof Error ? err.message : String(err),
            }, currentDeviceInfo)
            const errorMessage = err instanceof Error ? err.message : 'Unknown error'
            alert(`Failed to clock out: ${errorMessage}`)
        } finally {
            setClockLoading(false)
        }
    }

    // Refresh the "on lunch for N min" counter while a lunch is open
    useEffect(() => {
        if (!onLunch) return
        const t = setInterval(() => setNowTick(Date.now()), 30000)
        return () => clearInterval(t)
    }, [onLunch])

    const lunchElapsedMinutes = clockedIn?.break_start
        ? Math.max(0, Math.floor((nowTick - new Date(clockedIn.break_start).getTime()) / 60000))
        : 0

    // Start Lunch: stamp break_start on the open attendance row. The 30-minute
    // reminder cron watches this column.
    const handleStartLunch = async () => {
        if (!user?.id || !clockedIn || onLunch) return
        setLunchLoading(true)
        try {
            const supabase = createUntypedClient()
            const { data, error } = await supabase
                .from('attendance_logs')
                .update({ break_start: new Date().toISOString(), break_reminder_sent_at: null })
                .eq('id', clockedIn.id)
                .is('break_start', null)
                .is('clock_out', null)
                .select('id')
            if (error) throw error
            if (!data || data.length === 0) throw new Error('Lunch already started or shift closed')
            logButtonClick('Start Lunch', 'attendance', { attendanceId: clockedIn.id })
            setNowTick(Date.now())
            mutateAttendance()
        } catch (err) {
            console.error('Start lunch error:', err)
            alert('Could not start lunch. Please try again.')
            mutateAttendance()
        } finally {
            setLunchLoading(false)
        }
    }

    // End Lunch: fold the elapsed minutes into break_minutes and clear break_start.
    const handleEndLunch = async () => {
        if (!user?.id || !clockedIn?.break_start) return
        setLunchLoading(true)
        try {
            const supabase = createUntypedClient()
            const minutes = Math.max(1, Math.round((Date.now() - new Date(clockedIn.break_start).getTime()) / 60000))
            const { data, error } = await supabase
                .from('attendance_logs')
                .update({
                    break_start: null,
                    break_reminder_sent_at: null,
                    break_minutes: (clockedIn.break_minutes || 0) + minutes,
                })
                .eq('id', clockedIn.id)
                .not('break_start', 'is', null)
                .select('id')
            if (error) throw error
            if (!data || data.length === 0) throw new Error('Lunch was already ended')
            logButtonClick('End Lunch', 'attendance', { attendanceId: clockedIn.id, minutes })
            mutateAttendance()
        } catch (err) {
            console.error('End lunch error:', err)
            alert('Could not end lunch. Please try again.')
            mutateAttendance()
        } finally {
            setLunchLoading(false)
        }
    }

    // Handle clock out - check for pending tasks first
    const handleClockOut = () => {
        if (!user?.id || !clockedIn) {
            alert('You must be clocked in to clock out')
            return
        }

        if (!currentDeviceInfo) {
            alert('Unable to identify your device. Please refresh the page.')
            return
        }

        // Compute pending tasks from the tasks already loaded
        const currentPendingTasks = tasks.filter((t) => t.status === 'pending')
        if (currentPendingTasks.length > 0) {
            setShowPendingTasksModal(true)
            return
        }

        performClockOut()
    }

    // Handle clock out with reminder email
    const handleClockOutWithReminder = async () => {
        setPendingTaskReminderSending(true)
        setShowPendingTasksModal(false)

        await performClockOut()

        // Fire-and-forget: send reminder email
        const currentPendingTasks = tasks.filter((t) => t.status === 'pending')
        if (currentPendingTasks.length > 0) {
            fetch('/api/tasks/reminder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ taskNames: currentPendingTasks.map((t) => t.title) }),
            }).catch((err) => console.error('Failed to send task reminder:', err))
        }

        setPendingTaskReminderSending(false)
    }

    // Show loading only on initial auth load (with timeout to prevent infinite loading)
    if (authLoading && !loadingTimeout) {
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
            {/* New Device? — self-service device re-registration */}
            <DeviceResetModal
                open={showDeviceReset}
                onClose={() => setShowDeviceReset(false)}
                userEmail={user?.email}
                currentDeviceInfo={currentDeviceInfo}
                registeredDeviceName={registeredDeviceName}
                registeredDeviceId={registeredDeviceId}
                onRegistered={() => mutateAttendance()}
            />

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

            {/* Pending Tasks Warning Modal */}
            {showPendingTasksModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-card rounded-xl shadow-xl w-full max-w-md border">
                        <div className="p-6">
                            <div className="text-center mb-6">
                                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center">
                                    <svg className="w-8 h-8 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                                    </svg>
                                </div>
                                <h2 className="text-xl font-bold mb-2">Pending Tasks</h2>
                                <p className="text-muted-foreground text-sm">
                                    You still have {pendingTasks.length} pending task{pendingTasks.length !== 1 ? 's' : ''} for today.
                                </p>
                            </div>

                            {/* Pending task list */}
                            <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg max-h-48 overflow-y-auto">
                                <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200 mb-2">
                                    Unfinished Tasks
                                </p>
                                <ul className="space-y-1">
                                    {pendingTasks.map((task) => (
                                        <li key={task.id} className="text-sm text-yellow-700 dark:text-yellow-300 flex items-start gap-2">
                                            <span className="flex-shrink-0 mt-0.5">⬜</span>
                                            <span>{task.title}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>

                            <div className="space-y-3">
                                <button
                                    onClick={() => setShowPendingTasksModal(false)}
                                    className="btn-primary w-full"
                                >
                                    Go Back to Finish Tasks
                                </button>

                                <button
                                    onClick={handleClockOutWithReminder}
                                    disabled={pendingTaskReminderSending || clockLoading}
                                    className="btn-destructive w-full flex items-center justify-center gap-2"
                                >
                                    {pendingTaskReminderSending || clockLoading ? (
                                        <>
                                            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                            </svg>
                                            Clocking Out...
                                        </>
                                    ) : (
                                        'Clock Out Anyway'
                                    )}
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
                        timeZone: 'America/New_York',
                    })}
                </p>
            </div>

            {/* Turn on browser reminders (hidden once enabled) */}
            <PushReminderPrompt onStatusChange={setPushStatus} />

            {/* Clock In/Out Card */}
            <div className="card rounded-2xl shadow-[0_4px_16px_rgba(15,23,42,0.06)]">
                <div className="p-5 sm:p-6">
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
                        <div className="flex items-center gap-3 min-w-0">
                            <div className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl ${onLunch ? 'bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400' : clockedIn ? 'bg-green-100 text-green-600 dark:bg-green-950 dark:text-green-400' : 'bg-indigo-50 text-indigo-500 dark:bg-indigo-950 dark:text-indigo-300'}`}>
                                <NavIcon name="clock" className="h-6 w-6" />
                            </div>
                            <div className="min-w-0">
                                <h2 className="text-lg font-semibold">Time Clock</h2>
                                {clockedIn && onLunch ? (
                                    <p className="text-sm font-medium text-amber-700 dark:text-amber-300" data-testid="lunch-status">
                                        On lunch for {lunchElapsedMinutes} min{lunchElapsedMinutes >= 30 ? ' — time to clock back in' : ''}
                                    </p>
                                ) : clockedIn ? (
                                    <p className="text-muted-foreground text-sm">
                                        Clocked in at {formatDateTime(clockedIn.clock_in)}
                                        {(clockedIn.break_minutes || 0) > 0 ? ` · ${clockedIn.break_minutes} min lunch taken` : ''}
                                    </p>
                                ) : (
                                    <p className="text-muted-foreground text-sm">You are not clocked in</p>
                                )}
                            </div>
                        </div>
                        <div className="flex flex-col gap-2 w-full sm:w-auto">
                            <button
                                onClick={clockedIn ? handleClockOut : handleClockIn}
                                disabled={clockLoading || (!clockedIn && deviceMismatch)}
                                className={`inline-flex h-14 w-full sm:w-auto sm:min-w-[180px] items-center justify-center gap-2 rounded-2xl px-6 text-base font-semibold text-white transition-transform active:scale-[0.98] ${clockedIn
                                    ? 'bg-destructive shadow-[0_6px_16px_-4px_rgba(239,68,68,0.45)]'
                                    : 'bg-gradient-to-r from-indigo-500 to-violet-500 shadow-[0_6px_16px_-4px_rgba(99,102,241,0.5)]'
                                    } ${!clockedIn && deviceMismatch ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                                {clockLoading ? (
                                    <>
                                        <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                        </svg>
                                        {clockedIn ? 'Clocking Out...' : 'Clocking In...'}
                                    </>
                                ) : clockedIn ? (
                                    <><NavIcon name="logout" className="h-5 w-5" strokeWidth={2} /> Clock Out</>
                                ) : (
                                    <><NavIcon name="clock" className="h-5 w-5" strokeWidth={2} /> Clock In</>
                                )}
                            </button>
                            {/* Start / End Lunch */}
                            {clockedIn && (
                                <button
                                    type="button"
                                    onClick={onLunch ? handleEndLunch : handleStartLunch}
                                    disabled={lunchLoading || clockLoading}
                                    data-testid={onLunch ? 'end-lunch' : 'start-lunch'}
                                    className={`inline-flex h-12 w-full sm:w-auto sm:min-w-[180px] items-center justify-center gap-2 rounded-2xl px-6 text-sm font-semibold transition-transform active:scale-[0.98] disabled:opacity-60 ${onLunch
                                        ? 'bg-amber-500 text-white shadow-[0_6px_16px_-4px_rgba(245,158,11,0.5)]'
                                        : 'border border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
                                        }`}
                                >
                                    {lunchLoading ? (
                                        onLunch ? 'Ending lunch…' : 'Starting lunch…'
                                    ) : onLunch ? (
                                        <>🍽️ End Lunch</>
                                    ) : (
                                        <>🍽️ Start Lunch</>
                                    )}
                                </button>
                            )}
                            {/* Device mismatch hint */}
                            {deviceMismatch && !clockedIn && (
                                <>
                                    <p className="text-xs text-red-600 dark:text-red-400 text-center">
                                        You can only clock in from your registered device.
                                    </p>
                                    <button
                                        onClick={() => setShowDeviceReset(true)}
                                        className="btn-secondary w-full text-sm h-11"
                                    >
                                        Using a new device? Register it
                                    </button>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Device Status */}
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                        {registeredDeviceId && (
                            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${deviceMismatch ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300' : 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300'}`}>
                                {deviceMismatch ? (
                                    <>Wrong device: use {formatDeviceDisplay(registeredDeviceName, registeredDeviceId)}</>
                                ) : (
                                    <><svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>Registered device: {formatDeviceDisplay(registeredDeviceName, registeredDeviceId)}</>
                                )}
                            </span>
                        )}
                        {!registeredDeviceId && (
                            <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                                No device registered yet. Tap Clock In to register this phone.
                            </span>
                        )}
                        {registeredDeviceId && !deviceMismatch && (
                            <button
                                onClick={() => setShowDeviceReset(true)}
                                className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/10"
                            >
                                New device? Register this one
                            </button>
                        )}
                        {pushStatus === 'subscribed' && (
                            <span data-testid="reminders-on" className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
                                Shift &amp; lunch reminders on
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {/* New Training Assigned */}
            {pendingTraining && pendingTraining.total_pending > 0 && (
                <Link
                    href="/employee/onboarding"
                    className="block card hover:shadow-md transition-shadow border-indigo-200 dark:border-indigo-800 bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20"
                >
                    <div className="p-4 sm:p-6">
                        <div className="flex items-start justify-between gap-3 sm:gap-4 mb-3">
                            <div className="flex items-start gap-3 min-w-0">
                                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white text-xl sm:text-2xl flex items-center justify-center shadow-md flex-shrink-0">
                                    📚
                                </div>
                                <div className="min-w-0">
                                    <h2 className="text-base sm:text-lg font-semibold text-indigo-900 dark:text-indigo-100">
                                        {pendingTraining.new_count > 0
                                            ? `${pendingTraining.new_count} new training item${pendingTraining.new_count !== 1 ? 's' : ''} assigned`
                                            : 'Training in progress'}
                                    </h2>
                                    <p className="text-xs sm:text-sm text-indigo-700 dark:text-indigo-300 mt-0.5">
                                        {pendingTraining.in_progress_count > 0 && pendingTraining.new_count > 0 && (
                                            <>+ {pendingTraining.in_progress_count} in progress · </>
                                        )}
                                        {pendingTraining.in_progress_count > 0 && pendingTraining.new_count === 0 && (
                                            <>{pendingTraining.in_progress_count} item{pendingTraining.in_progress_count !== 1 ? 's' : ''} to finish · </>
                                        )}
                                        Tap to view
                                    </p>
                                </div>
                            </div>
                            <span className="text-indigo-600 dark:text-indigo-400 text-xl sm:text-2xl flex-shrink-0">→</span>
                        </div>
                        {pendingTraining.items.length > 0 && (
                            <ul className="space-y-1.5 mt-3">
                                {pendingTraining.items.map((item) => (
                                    <li
                                        key={item.id}
                                        className="flex items-center gap-2 text-sm text-indigo-900 dark:text-indigo-100"
                                    >
                                        <span className="flex-shrink-0">{trainingIcon(item)}</span>
                                        <span className="truncate">{item.title}</span>
                                        {item.business_name && (
                                            <span className="text-xs text-indigo-600 dark:text-indigo-400 truncate hidden sm:inline">
                                                · {item.business_name}
                                            </span>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </Link>
            )}

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
                                                {formatTimeString(task.cutoff_time)}
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

            {/* Important Messages */}
            {policies.length > 0 && (
                <div className="card">
                    <div className="card-header">
                        <h2 className="card-title text-base sm:text-lg flex items-center gap-2">
                            📋 Important Messages
                            {(() => {
                                const unread = policies.filter(p => !readPolicySet.has(p.id)).length
                                return unread > 0 ? (
                                    <span className="badge-warning text-xs">{unread} unread</span>
                                ) : null
                            })()}
                        </h2>
                    </div>
                    <div className="card-content">
                        <div className="space-y-2 sm:space-y-3">
                            {policies.map((policy) => {
                                const isRead = readPolicySet.has(policy.id)
                                return (
                                    <div
                                        key={policy.id}
                                        className={`p-3 sm:p-4 rounded-lg border transition-opacity ${
                                            isRead
                                                ? 'bg-muted/40 border-border opacity-70'
                                                : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
                                        }`}
                                    >
                                        <div className="flex items-start gap-2 sm:gap-3">
                                            <span className="text-base sm:text-lg flex-shrink-0">
                                                {isRead ? '✅' : '📌'}
                                            </span>
                                            <div className="min-w-0 flex-1">
                                                <p className={`font-medium text-sm sm:text-base ${
                                                    isRead
                                                        ? 'text-muted-foreground'
                                                        : 'text-blue-900 dark:text-blue-100'
                                                }`}>
                                                    {policy.title}
                                                </p>
                                                <RichTextDisplay
                                                    content={policy.content}
                                                    className={`text-xs sm:text-sm mt-1 ${
                                                        isRead
                                                            ? 'text-muted-foreground'
                                                            : 'text-blue-800 dark:text-blue-200'
                                                    }`}
                                                />
                                                <div className="flex items-center justify-between gap-2 mt-3 flex-wrap">
                                                    {policy.category ? (
                                                        <span className="badge-outline text-xs">{policy.category}</span>
                                                    ) : <span />}
                                                    {isRead ? (
                                                        <span className="text-xs text-green-700 dark:text-green-300 font-medium">
                                                            ✓ Marked as read
                                                        </span>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            onClick={() => markPolicyRead(policy.id)}
                                                            disabled={markingReadId === policy.id}
                                                            className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-50"
                                                        >
                                                            {markingReadId === policy.id ? 'Marking…' : 'Mark as Read'}
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
