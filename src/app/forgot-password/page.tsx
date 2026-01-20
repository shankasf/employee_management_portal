'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState(false)
    const supabase = createClient()

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        setError(null)

        try {
            // First check if user exists in the system
            const response = await fetch('/api/auth/check-user', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            })

            const data = await response.json()

            if (!data.exists) {
                setError('No account found with this email address.')
                setLoading(false)
                return
            }

            // Send password reset email
            const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: `${window.location.origin}/reset-password`,
            })

            if (error) {
                setError(error.message)
            } else {
                setSuccess(true)
            }
        } catch (err) {
            setError('An unexpected error occurred. Please try again.')
            console.error(err)
        } finally {
            setLoading(false)
        }
    }

    if (success) {
        return (
            <div className="min-h-screen min-h-[100dvh] flex items-center justify-center bg-gradient-to-br from-indigo-50 to-blue-100 dark:from-gray-900 dark:to-gray-800 p-4 safe-top safe-bottom">
                <div className="card w-full max-w-sm sm:max-w-md">
                    <div className="card-header text-center">
                        <div className="mx-auto w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mb-4">
                            <svg className="w-6 h-6 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                        </div>
                        <h1 className="text-xl sm:text-2xl font-bold">Check your email</h1>
                        <p className="card-description text-sm mt-2">
                            We&apos;ve sent a password reset link to <strong>{email}</strong>
                        </p>
                    </div>
                    <div className="card-content">
                        <p className="text-sm text-muted-foreground text-center mb-4">
                            Click the link in the email to reset your password. The link will expire in 1 hour.
                        </p>
                        <p className="text-xs text-muted-foreground text-center">
                            Didn&apos;t receive the email? Check your spam folder or{' '}
                            <button
                                onClick={() => setSuccess(false)}
                                className="text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
                            >
                                try again
                            </button>
                        </p>
                    </div>
                    <div className="card-footer justify-center">
                        <Link href="/login" className="text-sm text-indigo-600 hover:text-indigo-500 dark:text-indigo-400">
                            Back to sign in
                        </Link>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen min-h-[100dvh] flex items-center justify-center bg-gradient-to-br from-indigo-50 to-blue-100 dark:from-gray-900 dark:to-gray-800 p-4 safe-top safe-bottom">
            <div className="card w-full max-w-sm sm:max-w-md">
                <div className="card-header text-center">
                    <h1 className="text-xl sm:text-2xl font-bold text-indigo-600 dark:text-indigo-400">
                        Reset Password
                    </h1>
                    <p className="card-description text-sm">
                        Enter your email address and we&apos;ll send you a link to reset your password.
                    </p>
                </div>
                <div className="card-content">
                    <form onSubmit={handleSubmit} className="space-y-4">
                        {error && (
                            <div className="p-3 text-xs sm:text-sm text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400 rounded-md">
                                {error}
                            </div>
                        )}

                        <div className="space-y-1.5 sm:space-y-2">
                            <label htmlFor="email" className="label">
                                Email address
                            </label>
                            <input
                                id="email"
                                type="email"
                                className="input"
                                placeholder="your.email@playfunia.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                disabled={loading}
                            />
                        </div>

                        <button
                            type="submit"
                            className="btn-primary w-full"
                            disabled={loading}
                        >
                            {loading ? (
                                <span className="flex items-center justify-center gap-2">
                                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                        <circle
                                            className="opacity-25"
                                            cx="12"
                                            cy="12"
                                            r="10"
                                            stroke="currentColor"
                                            strokeWidth="4"
                                            fill="none"
                                        />
                                        <path
                                            className="opacity-75"
                                            fill="currentColor"
                                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                        />
                                    </svg>
                                    Sending...
                                </span>
                            ) : (
                                'Send Reset Link'
                            )}
                        </button>
                    </form>
                </div>
                <div className="card-footer justify-center">
                    <Link href="/login" className="text-sm text-indigo-600 hover:text-indigo-500 dark:text-indigo-400">
                        Back to sign in
                    </Link>
                </div>
            </div>
        </div>
    )
}
