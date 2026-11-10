'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { createUntypedClient } from '@/lib/supabase/client'
import { formatDateTime, getTodayNY, getNYOffsetStr } from '@/lib/utils'
import DeviceResetModal from '@/components/DeviceResetModal'
import { getDeviceInfo, formatDeviceDisplay } from '@/lib/device'
import { captureLocation } from '@/lib/geolocation'
import { logClockDebug } from '@/lib/clock-debug-log'
import { logButtonClick } from '@/lib/usage-log'
import { invalidateQueries } from '@/lib/hooks/useData'

async function resolveLocationName(lat: number | null, lng: number | null): Promise<string | null> {
    if (lat == null || lng == null) return null
    try {
        const res = await fetch(`/api/geocode?lat=${lat}&lng=${lng}`)
        if (!res.ok) return null
        const data = await res.json()
        return data.location || null
    } catch {
        return null
    }
}

interface PendingTask {
    id: string
    title: string
}

interface ClockInOutCardProps {
    clockedIn: { id: string; clock_in: string } | null
    pendingTasks: PendingTask[]
    deviceData: { registered_device_id: string | null; device_name: string | null } | null
    onChange: () => void
}

export default function ClockInOutCard({ clockedIn, pendingTasks, deviceData, onChange }: ClockInOutCardProps) {
    const { user } = useAuth()
    const [clockLoading, setClockLoading] = useState(false)

    const [showDevicePrompt, setShowDevicePrompt] = useState(false)
    const [showDeviceReset, setShowDeviceReset] = useState(false)
    const [deviceRegistering, setDeviceRegistering] = useState(false)
    const [currentDeviceInfo, setCurrentDeviceInfo] = useState<{ deviceId: string; deviceName: string } | null>(null)

    const [showPendingTasksModal, setShowPendingTasksModal] = useState(false)
    const [pendingTaskReminderSending, setPendingTaskReminderSending] = useState(false)

    const registeredDeviceId = deviceData?.registered_device_id || null
    const registeredDeviceName = deviceData?.device_name || null
    const deviceMismatch = currentDeviceInfo && registeredDeviceId
        ? registeredDeviceId !== currentDeviceInfo.deviceId
        : false

    useEffect(() => {
        if (!user?.id) return
        let stale = false
        getDeviceInfo(user.id).then((info) => {
            if (!stale) setCurrentDeviceInfo(info)
        })
        return () => { stale = true }
    }, [user?.id])

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

    const handleClockIn = async () => {
        if (!user?.id) {
            logClockDebug('clock_in', 'auth_check', 'fail', 'User not logged in')
            alert('You must be logged in to clock in')
            return
        }
        logClockDebug('clock_in', 'auth_check', 'pass', 'User authenticated', { userId: user.id }, currentDeviceInfo)

        if (!currentDeviceInfo) {
            logClockDebug('device_registration', 'device_detection', 'fail', 'Unable to detect device info')
            alert('Unable to identify your device. Please refresh the page.')
            return
        }
        logClockDebug('device_registration', 'device_detection', 'pass', 'Device detected', {
            deviceId: currentDeviceInfo.deviceId,
            deviceName: currentDeviceInfo.deviceName,
        }, currentDeviceInfo)

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
                onChange()
                return
            }
            logClockDebug('clock_in', 'already_clocked_in', 'pass', 'Not currently clocked in', undefined, currentDeviceInfo)

            const location = await captureLocation()
            logClockDebug('clock_in', 'gps_capture', 'info', `GPS: ${location.status}`, {
                status: location.status,
                lat: location.lat,
                lng: location.lng,
                accuracy: location.accuracy,
            }, currentDeviceInfo)

            const todayNY = getTodayNY()
            const offsetStr = getNYOffsetStr(todayNY)
            const todayStartUTC = new Date(`${todayNY}T00:00:00${offsetStr}`).toISOString()
            const todayEndUTC = new Date(`${todayNY}T23:59:59${offsetStr}`).toISOString()

            const { data: completedToday } = await supabase
                .from('attendance_logs')
                .select('id, clock_out, break_minutes, break_locations')
                .eq('employee_id', user.id)
                .not('clock_out', 'is', null)
                .gte('clock_in', todayStartUTC)
                .lte('clock_in', todayEndUTC)
                .order('clock_out', { ascending: false })
                .limit(1)

            if (completedToday && completedToday.length > 0) {
                const prevEntry = completedToday[0]
                const prevClockOut = new Date(prevEntry.clock_out).getTime()
                const now = Date.now()
                const breakGap = Math.round((now - prevClockOut) / 60000)

                const existingBreakLocations = Array.isArray(prevEntry.break_locations) ? prevEntry.break_locations : []
                const newBreakLocation = {
                    lat: location.lat,
                    lng: location.lng,
                    accuracy: location.accuracy,
                    status: location.status,
                    timestamp: new Date().toISOString(),
                }

                const { data: breakData, error: breakError } = await supabase
                    .from('attendance_logs')
                    .update({
                        clock_out: null,
                        clock_out_device_id: null,
                        clock_out_device_name: null,
                        clock_out_lat: null,
                        clock_out_lng: null,
                        clock_out_accuracy: null,
                        clock_out_location_status: null,
                        clock_out_location_name: null,
                        actual_clock_out: null,
                        late_clock_out_minutes: null,
                        total_hours: null,
                        break_minutes: (prevEntry.break_minutes || 0) + breakGap,
                        break_locations: [...existingBreakLocations, newBreakLocation],
                    })
                    .eq('id', prevEntry.id)
                    .select('id')

                if (breakError) {
                    logClockDebug('clock_in', 'break_return', 'fail', `Break return failed: ${breakError.message}`, {
                        errorCode: breakError.code,
                        errorMessage: breakError.message,
                    }, currentDeviceInfo)
                    throw breakError
                }

                if (!breakData || breakData.length === 0) {
                    logClockDebug('clock_in', 'break_return', 'fail', 'Break return update affected 0 rows (possible RLS restriction)', {
                        attendanceId: prevEntry.id,
                    }, currentDeviceInfo)
                    throw new Error('Unable to resume from break. Please contact your admin.')
                }

                logClockDebug('clock_in', 'break_return', 'pass', `Break return: ${breakGap}m gap added`, {
                    attendanceId: prevEntry.id,
                    breakGapMinutes: breakGap,
                    totalBreakMinutes: (prevEntry.break_minutes || 0) + breakGap,
                }, currentDeviceInfo)

                logButtonClick('Clock In (Break Return)', 'attendance', { deviceId: currentDeviceInfo.deviceId })
                onChange()
                return
            }

            let shiftTiming = 'Not set'
            const { data: todaySchedules } = await supabase
                .from('schedules')
                .select('start_time, end_time')
                .eq('employee_id', user.id)
                .eq('schedule_date', todayNY)
                .neq('status', 'cancelled')
                .order('start_time', { ascending: true })
                .limit(1)

            if (todaySchedules && todaySchedules.length > 0) {
                const sched = todaySchedules[0]
                if (sched.start_time && sched.end_time) {
                    const fmtTime = (t: string) => {
                        const [hh, mm] = t.split(':').map(Number)
                        const ampm = hh >= 12 ? 'PM' : 'AM'
                        const h12 = hh % 12 || 12
                        return `${h12}:${String(mm).padStart(2, '0')} ${ampm}`
                    }
                    shiftTiming = `${fmtTime(sched.start_time)} - ${fmtTime(sched.end_time)}`
                }
            }

            const clockInLocationName = await resolveLocationName(location.lat, location.lng)

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
                    clock_in_location_name: clockInLocationName,
                    shift_timing: shiftTiming,
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

            logButtonClick('Clock In', 'attendance', { deviceId: currentDeviceInfo.deviceId })
            logClockDebug('clock_in', 'complete', 'success', 'Clock in completed successfully', undefined, currentDeviceInfo)

            onChange()
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

    const performClockOut = async () => {
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

            const location = await captureLocation()
            logClockDebug('clock_out', 'gps_capture', 'info', `GPS: ${location.status}`, {
                status: location.status,
                lat: location.lat,
                lng: location.lng,
                accuracy: location.accuracy,
            }, currentDeviceInfo)

            const todayNY = getTodayNY()
            let effectiveClockOut = actualClockOutISO
            let lateClockOutMinutes: number | null = null
            let actualClockOutValue: string | null = null

            const { data: schedules } = await supabase
                .from('schedules')
                .select('schedule_date, start_time, end_time')
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
                const lastSchedule = schedules[schedules.length - 1]
                if (lastSchedule.end_time) {
                    const offsetStr = getNYOffsetStr(todayNY)
                    const scheduledEndUTC = new Date(`${todayNY}T${lastSchedule.end_time}${offsetStr}`)

                    if (actualClockOutTime.getTime() > scheduledEndUTC.getTime()) {
                        effectiveClockOut = scheduledEndUTC.toISOString()
                        actualClockOutValue = actualClockOutISO
                        lateClockOutMinutes = Math.ceil(
                            (actualClockOutTime.getTime() - scheduledEndUTC.getTime()) / 60000
                        )

                        logClockDebug('clock_out', 'late_checkout', 'info', `Late by ${lateClockOutMinutes} min — capped at scheduled end`, {
                            scheduledEnd: scheduledEndUTC.toISOString(),
                            actualClockOut: actualClockOutISO,
                            effectiveClockOut,
                            lateMinutes: lateClockOutMinutes,
                        }, currentDeviceInfo)
                    }
                }
            }

            const clockOutLocationName = await resolveLocationName(location.lat, location.lng)

            // If a lunch is still open, fold it into break_minutes so the hours
            // trigger sees it and no dangling break_start is left behind.
            const { data: openRow } = await supabase
                .from('attendance_logs')
                .select('break_start, break_minutes')
                .eq('id', clockedIn.id)
                .maybeSingle()
            const breakClose: { break_start?: null; break_minutes?: number; break_reminder_sent_at?: null } = {}
            if (openRow?.break_start) {
                const lunchMinutes = Math.max(1, Math.round((actualClockOutTime.getTime() - new Date(openRow.break_start).getTime()) / 60000))
                breakClose.break_start = null
                breakClose.break_reminder_sent_at = null
                breakClose.break_minutes = (openRow.break_minutes || 0) + lunchMinutes
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
                    clock_out_location_name: clockOutLocationName,
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

            if (data && data.clock_in && !data.total_hours) {
                const clockInTime = new Date(data.clock_in).getTime()
                const clockOutTimeMs = new Date(effectiveClockOut).getTime()
                const breakMins = data.break_minutes || 0
                let totalHours = (clockOutTimeMs - clockInTime) / (1000 * 60 * 60) - breakMins / 60
                totalHours = Math.round(Math.max(0, totalHours) * 100) / 100

                if (schedules && schedules.length > 0) {
                    const firstSched = schedules[0] as { start_time?: string; end_time?: string }
                    if (firstSched.start_time && firstSched.end_time) {
                        const [sh, sm] = firstSched.start_time.split(':').map(Number)
                        const [eh, em] = firstSched.end_time.split(':').map(Number)
                        const scheduledHours = Math.round(((eh * 60 + em) - (sh * 60 + sm)) / 60 * 100) / 100
                        if (scheduledHours > 0 && totalHours > scheduledHours) {
                            totalHours = scheduledHours
                        }
                    }
                }

                logClockDebug('clock_out', 'hours_calc', 'info', `Fallback hours calc: ${totalHours}h (break: ${breakMins}m)`, {
                    clockIn: data.clock_in,
                    clockOut: effectiveClockOut,
                    breakMinutes: breakMins,
                    totalHours,
                }, currentDeviceInfo)

                await supabase
                    .from('attendance_logs')
                    .update({ total_hours: totalHours })
                    .eq('id', clockedIn.id)
            }

            logButtonClick('Clock Out', 'attendance', { deviceId: currentDeviceInfo.deviceId })
            logClockDebug('clock_out', 'complete', 'success', 'Clock out completed successfully', undefined, currentDeviceInfo)

            onChange()
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

    const handleClockOut = () => {
        if (!user?.id || !clockedIn) {
            alert('You must be clocked in to clock out')
            return
        }

        if (!currentDeviceInfo) {
            alert('Unable to identify your device. Please refresh the page.')
            return
        }

        if (pendingTasks.length > 0) {
            setShowPendingTasksModal(true)
            return
        }

        performClockOut()
    }

    const handleClockOutWithReminder = async () => {
        setPendingTaskReminderSending(true)
        setShowPendingTasksModal(false)

        await performClockOut()

        if (pendingTasks.length > 0) {
            fetch('/api/tasks/reminder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ taskNames: pendingTasks.map((t) => t.title) }),
            }).catch((err) => console.error('Failed to send task reminder:', err))
        }

        setPendingTaskReminderSending(false)
    }

    return (
        <>
            {/* New Device? — self-service device re-registration */}
            <DeviceResetModal
                open={showDeviceReset}
                onClose={() => setShowDeviceReset(false)}
                userEmail={user?.email}
                currentDeviceInfo={currentDeviceInfo}
                registeredDeviceName={registeredDeviceName}
                registeredDeviceId={registeredDeviceId}
                onRegistered={() => onChange?.()}
            />

            {/* Device Registration Modal */}
            {showDevicePrompt && (
                <div className="fixed inset-0 bg-black/50 z-50 overflow-y-auto">
                    <div className="flex min-h-full items-center justify-center p-4">
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
                </div>
            )}

            {/* Pending Tasks Warning Modal */}
            {showPendingTasksModal && (
                <div className="fixed inset-0 bg-black/50 z-50 overflow-y-auto">
                    <div className="flex min-h-full items-center justify-center p-4">
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
                </div>
            )}

            {/* Clock In/Out Card */}
            <div className="card">
                <div className="p-4 sm:p-6">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
                        <div>
                            <h2 className="text-base sm:text-lg font-semibold">Time Clock</h2>
                            {clockedIn ? (
                                <p className="text-muted-foreground text-sm">
                                    Clocked in at {formatDateTime(clockedIn.clock_in)}
                                </p>
                            ) : (
                                <p className="text-muted-foreground text-sm">You are not clocked in</p>
                            )}
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
                            {registeredDeviceId && !deviceMismatch && (
                                <button
                                    onClick={() => setShowDeviceReset(true)}
                                    className="text-xs mt-1 text-blue-600 dark:text-blue-400 hover:underline text-left"
                                >
                                    📱 New device? Register this one
                                </button>
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
                            {deviceMismatch && !clockedIn && (
                                <>
                                    <p className="text-xs text-red-600 dark:text-red-400 text-center">
                                        You can only clock in from your registered device.
                                    </p>
                                    <button
                                        onClick={() => setShowDeviceReset(true)}
                                        className="btn-secondary w-full text-sm"
                                    >
                                        📱 Using a new device? Register it
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </>
    )
}
