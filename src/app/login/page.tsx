'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

function LoginForm() {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [sessionExpired, setSessionExpired] = useState(false)
    const [loading, setLoading] = useState(false)
    const [googleLoading, setGoogleLoading] = useState(false)
    const router = useRouter()
    const searchParams = useSearchParams()
    const supabase = createClient()

    // Check if redirected due to session expiration or Google auth error
    useEffect(() => {
        if (searchParams.get('expired') === 'true') {
            setSessionExpired(true)
            // Clear the expired param from URL without reload to prevent message persisting
            const url = new URL(window.location.href)
            url.searchParams.delete('expired')
            window.history.replaceState({}, '', url.pathname + url.search)
        }
        const authError = searchParams.get('error')
        if (authError === 'not_existing_user') {
            setError('Google sign-in is only available for existing employees. Please use email/password or contact your administrator.')
        }
    }, [searchParams])

    // Handle Google Sign-in
    const handleGoogleSignIn = async () => {
        setGoogleLoading(true)
        setError(null)

        try {
            const { error } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: {
                    redirectTo: `${window.location.origin}/auth/callback`,
                    queryParams: {
                        access_type: 'offline',
                        prompt: 'select_account',
                    },
                },
            })

            if (error) {
                setError(error.message)
                setGoogleLoading(false)
            }
        } catch (err) {
            setError('Failed to initiate Google sign-in')
            setGoogleLoading(false)
            console.error(err)
        }
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        setError(null)

        try {
            const { data, error } = await supabase.auth.signInWithPassword({
                email,
                password,
            })

            if (error) {
                setError(error.message)
                return
            }

            if (data.user) {
                // Get user's role to redirect appropriately
                // Use the same supabase client that has the auth session
                const { data: profile } = await supabase
                    .from('profiles')
                    .select('role')
                    .eq('id', data.user.id)
                    .single()

                if ((profile as { role: string } | null)?.role === 'admin') {
                    router.push('/admin')
                } else {
                    router.push('/employee')
                }
                // Note: router.refresh() removed - middleware handles session properly
            }
        } catch (err) {
            setError('An unexpected error occurred')
            console.error(err)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="card w-full max-w-sm sm:max-w-md">
            <div className="card-header text-center">
                <h1 className="text-2xl sm:text-3xl font-bold text-indigo-600 dark:text-indigo-400">
                    PlayFunia
                </h1>
                <p className="card-description text-sm">Sign in to your employee portal</p>
            </div>
            <div className="card-content">
                <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-4">
                    {sessionExpired && (
                        <div className="p-3 text-xs sm:text-sm text-amber-700 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400 rounded-md">
                            Your session has expired. Please sign in again.
                        </div>
                    )}
                    {error && (
                        <div className="p-3 text-xs sm:text-sm text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400 rounded-md">
                            {error}
                        </div>
                    )}

                    <div className="space-y-1.5 sm:space-y-2">
                        <label htmlFor="email" className="label">
                            Email
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

                    <div className="space-y-1.5 sm:space-y-2">
                        <div className="flex justify-between items-center">
                            <label htmlFor="password" className="label">
                                Password
                            </label>
                            <Link
                                href="/forgot-password"
                                className="text-xs text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
                            >
                                Forgot password?
                            </Link>
                        </div>
                        <input
                            id="password"
                            type="password"
                            className="input"
                            placeholder="Enter your password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            disabled={loading}
                        />
                    </div>

                    <button
                        type="submit"
                        className="btn-primary w-full"
                        disabled={loading || googleLoading}
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
                                Signing in...
                            </span>
                        ) : (
                            'Sign In'
                        )}
                    </button>

                    <div className="relative my-4">
                        <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-gray-200 dark:border-gray-700"></div>
                        </div>
                        <div className="relative flex justify-center text-xs">
                            <span className="px-2 bg-white dark:bg-gray-800 text-muted-foreground">
                                or continue with
                            </span>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={handleGoogleSignIn}
                        className="w-full flex items-center justify-center gap-3 px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={loading || googleLoading}
                    >
                        {googleLoading ? (
                            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
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
                        ) : (
                            <svg className="h-5 w-5" viewBox="0 0 24 24">
                                <path
                                    fill="#4285F4"
                                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                                />
                                <path
                                    fill="#34A853"
                                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                                />
                                <path
                                    fill="#FBBC05"
                                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                                />
                                <path
                                    fill="#EA4335"
                                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                                />
                            </svg>
                        )}
                        <span>{googleLoading ? 'Signing in...' : 'Sign in with Google'}</span>
                    </button>
                </form>
            </div>
            <div className="card-footer flex-col space-y-2 text-center text-xs sm:text-sm text-muted-foreground">
                <p>Only existing employees can sign in.</p>
            </div>
        </div>
    )
}

function LoginFormFallback() {
    return (
        <div className="card w-full max-w-sm sm:max-w-md">
            <div className="card-header text-center">
                <h1 className="text-2xl sm:text-3xl font-bold text-indigo-600 dark:text-indigo-400">
                    PlayFunia
                </h1>
                <p className="card-description text-sm">Sign in to your employee portal</p>
            </div>
            <div className="card-content animate-pulse">
                <div className="space-y-3 sm:space-y-4">
                    <div className="space-y-1.5 sm:space-y-2">
                        <div className="h-4 w-12 bg-muted rounded"></div>
                        <div className="h-10 bg-muted rounded"></div>
                    </div>
                    <div className="space-y-1.5 sm:space-y-2">
                        <div className="h-4 w-16 bg-muted rounded"></div>
                        <div className="h-10 bg-muted rounded"></div>
                    </div>
                    <div className="h-10 bg-muted rounded"></div>
                </div>
            </div>
        </div>
    )
}

export default function LoginPage() {
    return (
        <div className="min-h-screen min-h-[100dvh] flex items-center justify-center bg-gradient-to-br from-indigo-50 to-blue-100 dark:from-gray-900 dark:to-gray-800 p-4 safe-top safe-bottom">
            <Suspense fallback={<LoginFormFallback />}>
                <LoginForm />
            </Suspense>
        </div>
    )
}
