'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

function LoginForm() {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [sessionExpired, setSessionExpired] = useState(false)
    const [loading, setLoading] = useState(false)
    const router = useRouter()
    const searchParams = useSearchParams()
    const supabase = createClient()

    // Check if redirected due to session expiration
    useEffect(() => {
        if (searchParams.get('expired') === 'true') {
            setSessionExpired(true)
        }
    }, [searchParams])

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
                        <label htmlFor="password" className="label">
                            Password
                        </label>
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
                        disabled={loading}
                    >
                        {loading ? (
                            <span className="flex items-center gap-2">
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
                </form>
            </div>
            <div className="card-footer flex-col space-y-2 text-center text-xs sm:text-sm text-muted-foreground">
                <p>Forgot your password? Contact your administrator.</p>
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
