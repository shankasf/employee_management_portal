'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createUntypedClient } from '@/lib/supabase/client'
import { formatDeviceDisplay } from '@/lib/device'
import { logClockDebug } from '@/lib/clock-debug-log'
import { invalidateQueries } from '@/lib/hooks/useData'

interface DeviceResetModalProps {
    open: boolean
    onClose: () => void
    /** The signed-in user's email — used to re-verify the password. */
    userEmail: string | null | undefined
    /** The device we are switching TO (the current browser/phone). */
    currentDeviceInfo: { deviceId: string; deviceName: string } | null
    /** Human-readable name of the device currently on file (may be null). */
    registeredDeviceName: string | null
    registeredDeviceId: string | null
    /** Called after a successful re-registration so the caller can refresh state. */
    onRegistered?: () => void
}

/**
 * Self-service "New Device?" flow.
 *
 * When an employee (or admin) changes phones, their new device produces a new
 * fingerprint that no longer matches the one on file, so clock-in is blocked.
 * This modal lets them move their registration to the current device WITHOUT
 * needing an admin — but only after re-entering their account password, so a
 * borrowed/left-open session can't be used to hijack someone's clock-in device.
 * Every reset is written to the clock debug log for audit.
 */
export default function DeviceResetModal({
    open,
    onClose,
    userEmail,
    currentDeviceInfo,
    registeredDeviceName,
    registeredDeviceId,
    onRegistered,
}: DeviceResetModalProps) {
    const [password, setPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    if (!open) return null

    const close = () => {
        setPassword('')
        setError(null)
        setSubmitting(false)
        onClose()
    }

    const handleConfirm = async () => {
        setError(null)

        if (!currentDeviceInfo) {
            setError('Unable to identify this device. Please refresh the page and try again.')
            return
        }
        if (!userEmail) {
            setError('Could not read your account email. Please sign out and back in, then try again.')
            return
        }
        if (!password) {
            setError('Please enter your password to confirm.')
            return
        }

        setSubmitting(true)
        logClockDebug('device_registration', 'device_reset_start', 'info', 'Self-service device reset requested', {
            fromDeviceId: registeredDeviceId,
            fromDeviceName: registeredDeviceName,
            toDeviceId: currentDeviceInfo.deviceId,
            toDeviceName: currentDeviceInfo.deviceName,
        }, currentDeviceInfo)

        try {
            const supabase = createUntypedClient()

            // Step 1: re-verify identity with the account password. This proves
            // the person at the keyboard actually owns the account, not just
            // someone who found an unlocked session.
            const { error: authError } = await supabase.auth.signInWithPassword({
                email: userEmail,
                password,
            })
            if (authError) {
                logClockDebug('device_registration', 'device_reset_auth', 'fail', 'Password re-verification failed', {
                    errorMessage: authError.message,
                }, currentDeviceInfo)
                setError('Incorrect password. Please try again.')
                setSubmitting(false)
                return
            }
            logClockDebug('device_registration', 'device_reset_auth', 'pass', 'Password re-verified', undefined, currentDeviceInfo)

            // Step 2: move the registration to this device (RPC overwrites the
            // caller's registered_device_id for auth.uid()).
            const { error: rpcError } = await supabase.rpc('register_device', {
                p_device_id: currentDeviceInfo.deviceId,
                p_device_name: currentDeviceInfo.deviceName,
            })
            if (rpcError) {
                logClockDebug('device_registration', 'device_reset', 'fail', `Device reset failed: ${rpcError.message}`, {
                    errorCode: rpcError.code,
                    errorMessage: rpcError.message,
                }, currentDeviceInfo)
                throw rpcError
            }

            logClockDebug('device_registration', 'device_reset', 'pass', 'Device registration moved to new device', {
                fromDeviceId: registeredDeviceId,
                toDeviceId: currentDeviceInfo.deviceId,
                toDeviceName: currentDeviceInfo.deviceName,
            }, currentDeviceInfo)

            invalidateQueries.all()
            onRegistered?.()
            close()
        } catch (err) {
            console.error('Device reset error:', err)
            setError('Could not update your device. Please try again in a moment.')
            setSubmitting(false)
        }
    }

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-card rounded-xl shadow-xl w-full max-w-md border">
                <div className="p-6">
                    <div className="text-center mb-6">
                        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                            <svg className="w-8 h-8 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                            </svg>
                        </div>
                        <h2 className="text-xl font-bold mb-2">Register a New Device</h2>
                        <p className="text-muted-foreground text-sm">
                            Got a new phone or browser? Make this the device you clock in from.
                            Your old device will no longer be able to clock in.
                        </p>
                    </div>

                    {/* Old → new device summary */}
                    <div className="mb-4 space-y-2">
                        {registeredDeviceId && (
                            <div className="p-3 bg-muted rounded-lg">
                                <p className="text-xs font-medium text-muted-foreground mb-1">Current device on file</p>
                                <p className="text-sm">{formatDeviceDisplay(registeredDeviceName, registeredDeviceId)}</p>
                            </div>
                        )}
                        <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                            <p className="text-xs font-medium text-blue-800 dark:text-blue-200 mb-1">This device (new)</p>
                            <p className="text-sm text-blue-700 dark:text-blue-300">
                                {currentDeviceInfo?.deviceName || 'Unknown Device'}
                            </p>
                            <p className="text-xs text-blue-600 dark:text-blue-400 font-mono mt-1">
                                ID: {currentDeviceInfo?.deviceId?.slice(-12) || 'N/A'}
                            </p>
                        </div>
                    </div>

                    {/* Password confirmation */}
                    <div className="mb-4">
                        <label htmlFor="device-reset-password" className="block text-sm font-medium mb-1">
                            Confirm your password
                        </label>
                        <div className="relative">
                            <input
                                id="device-reset-password"
                                type={showPassword ? 'text' : 'password'}
                                autoComplete="current-password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter' && !submitting) handleConfirm() }}
                                disabled={submitting}
                                className="input w-full pr-10"
                                placeholder="Your account password"
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                tabIndex={-1}
                                aria-label={showPassword ? 'Hide password' : 'Show password'}
                            >
                                {showPassword ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                                    </svg>
                                ) : (
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                    </svg>
                                )}
                            </button>
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2">
                            <p className="text-xs text-muted-foreground">
                                For security, confirm your password to move your clock-in device.
                            </p>
                            <Link
                                href="/forgot-password"
                                className="flex-shrink-0 text-xs font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
                            >
                                Forgot password? Reset it
                            </Link>
                        </div>
                    </div>

                    {error && (
                        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                            <p className="text-xs text-red-700 dark:text-red-300">{error}</p>
                        </div>
                    )}

                    <div className="space-y-3">
                        <button
                            onClick={handleConfirm}
                            disabled={submitting || !password}
                            className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {submitting ? (
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
                            onClick={close}
                            disabled={submitting}
                            className="btn-secondary w-full"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
