'use client'

import { createContext, useContext, useEffect, useState, useRef, useCallback, ReactNode } from 'react'
import { createClient } from '@/lib/supabase/client'
import { User, Session } from '@supabase/supabase-js'
import { Tables } from '@/types/supabase'

type Profile = Tables<'profiles'>
type Employee = Tables<'employees'>

interface AuthContextType {
    user: User | null
    profile: Profile | null
    employee: Employee | null
    session: Session | null
    isLoading: boolean
    isAdmin: boolean
    isEmployee: boolean
    signIn: (email: string, password: string) => Promise<{ error: Error | null }>
    signOut: () => Promise<void>
    refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

// Create singleton client outside component
const supabase = createClient()

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null)
    const [profile, setProfile] = useState<Profile | null>(null)
    const [employee, setEmployee] = useState<Employee | null>(null)
    const [session, setSession] = useState<Session | null>(null)
    const [isLoading, setIsLoading] = useState(true)

    // Track if we've already fetched profile for current user to prevent duplicates
    const fetchedUserIdRef = useRef<string | null>(null)
    const isFetchingRef = useRef(false)
    // Store user ref for session check interval (avoids stale closure)
    const userRef = useRef<User | null>(null)

    // Keep userRef in sync
    useEffect(() => {
        userRef.current = user
    }, [user])

    const fetchProfile = useCallback(async (userId: string, force = false) => {
        // Skip if already fetching or already fetched for this user (unless forced)
        if (isFetchingRef.current) return
        if (!force && fetchedUserIdRef.current === userId) return

        isFetchingRef.current = true

        try {
            // Fetch profile and employee data in parallel for better performance
            const [profileResult, employeeResult] = await Promise.allSettled([
                supabase
                    .from('profiles')
                    .select('*')
                    .eq('id', userId)
                    .single(),
                supabase
                    .from('employees')
                    .select('*')
                    .eq('id', userId)
                    .single()
            ])

            if (profileResult.status === 'fulfilled') {
                const { data: profileData, error: profileError } = profileResult.value
                if (profileError) {
                    console.error('Error fetching profile:', profileError.message)
                } else if (profileData) {
                    setProfile(profileData as Profile)
                }
            } else {
                console.error('Profile fetch failed:', profileResult.reason)
            }

            if (employeeResult.status === 'fulfilled') {
                const { data: employeeData, error: employeeError } = employeeResult.value
                if (employeeError) {
                    console.error('Error fetching employee:', employeeError.message)
                } else if (employeeData) {
                    setEmployee(employeeData as Employee)
                }
            } else {
                console.error('Employee fetch failed:', employeeResult.reason)
            }

            // Mark as fetched for this user
            fetchedUserIdRef.current = userId
        } catch (err) {
            console.error('Error in fetchProfile:', err)
        } finally {
            isFetchingRef.current = false
        }
    }, [])

    const refreshProfile = useCallback(async () => {
        if (user) {
            await fetchProfile(user.id, true) // Force refresh
        }
    }, [user, fetchProfile])

    useEffect(() => {
        let mounted = true

        const initAuth = async () => {
            try {
                // First try getSession() which reads from storage
                let { data: { session } } = await supabase.auth.getSession()
                if (!mounted) return

                // If no session found, try getUser() which validates against server
                // This handles cases where cookies exist but local storage was cleared
                if (!session) {
                    const { data: { user: validatedUser } } = await supabase.auth.getUser()
                    if (validatedUser && !mounted) return

                    if (validatedUser) {
                        // User is valid, refresh the session to sync state
                        const { data: { session: refreshedSession } } = await supabase.auth.refreshSession()
                        session = refreshedSession
                    }
                }

                setSession(session)
                setUser(session?.user ?? null)

                if (session?.user) {
                    await fetchProfile(session.user.id)
                }
            } catch (error) {
                console.error('Error initializing auth:', error)
            } finally {
                if (mounted) {
                    setIsLoading(false)
                }
            }
        }

        initAuth()

        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            async (event, session) => {
                if (!mounted) return

                // Skip INITIAL_SESSION - already handled by initAuth
                if (event === 'INITIAL_SESSION') {
                    return
                }


                // Handle token refresh - update session without fetching profile
                if (event === 'TOKEN_REFRESHED' && session) {
                    setSession(session)
                    setUser(session.user)
                    return
                }

                // Handle sign out - clear state and redirect
                if (event === 'SIGNED_OUT') {
                    fetchedUserIdRef.current = null
                    setUser(null)
                    setProfile(null)
                    setEmployee(null)
                    setSession(null)
                    setIsLoading(false)
                    // Redirect to login if on protected route
                    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
                        window.location.href = '/login'
                    }
                    return
                }

                // Handle sign in
                if (event === 'SIGNED_IN' && session?.user) {
                    setSession(session)
                    setUser(session.user)
                    await fetchProfile(session.user.id)
                    setIsLoading(false)
                    return
                }

                // For other events, update session state
                setSession(session)
                setUser(session?.user ?? null)

                if (!session?.user) {
                    fetchedUserIdRef.current = null
                    setProfile(null)
                    setEmployee(null)
                }

                setIsLoading(false)
            }
        )

        // PERFORMANCE: Periodic session refresh every 15 minutes
        // Uses refreshSession() instead of getUser() to avoid unnecessary server validation
        // Skips when tab is hidden to reduce background network calls
        const sessionCheckInterval = setInterval(async () => {
            if (!mounted) return

            // PERFORMANCE: Skip validation when tab is not visible
            if (typeof document !== 'undefined' && document.hidden) return

            const currentUser = userRef.current
            if (!currentUser) return // No user to refresh

            try {
                // Use refreshSession() - it proactively refreshes the token
                // This is more efficient than getUser() which validates against server
                const { data: { session: refreshedSession }, error } = await supabase.auth.refreshSession()

                if (error || !refreshedSession) {
                    console.warn('Session refresh failed, clearing state...')
                    fetchedUserIdRef.current = null
                    setUser(null)
                    setProfile(null)
                    setEmployee(null)
                    setSession(null)
                    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
                        window.location.href = '/login?expired=true'
                    }
                } else {
                    // Update session without triggering full profile fetch
                    setSession(refreshedSession)
                    setUser(refreshedSession.user)
                }
            } catch (err) {
                console.error('Session check error:', err)
            }
        }, 15 * 60 * 1000) // PERFORMANCE: Every 15 minutes (was 10)

        return () => {
            mounted = false
            subscription.unsubscribe()
            clearInterval(sessionCheckInterval)
        }
    }, [fetchProfile]) // fetchProfile is memoized with useCallback

    const signIn = async (email: string, password: string) => {
        const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
        })
        return { error }
    }

    const clearClientSession = () => {
        if (typeof window === 'undefined') return
        // Clear localStorage keys related to Supabase
        try {
            Object.keys(window.localStorage)
                .filter((k) => k.toLowerCase().includes('supabase'))
                .forEach((k) => window.localStorage.removeItem(k))
        } catch (err) {
            console.warn('localStorage clear warning:', err)
        }
        // Clear sb-* cookies set by Supabase auth helpers
        try {
            document.cookie
                .split(';')
                .map((c) => c.split('=')[0]?.trim())
                .filter((name) => name && (name.startsWith('sb-') || name.toLowerCase().includes('supabase')))
                .forEach((name) => {
                    document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`
                })
        } catch (err) {
            console.warn('cookie clear warning:', err)
        }
    }

    const signOut = async () => {
        const abort = new AbortController()
        const timeout = setTimeout(() => abort.abort(), 1500)
        try {
            // Call server-side signout to clear HttpOnly cookies used by middleware
            await fetch('/api/auth/signout', { method: 'POST', signal: abort.signal, cache: 'no-store', keepalive: true }).catch(() => undefined)

            await supabase.auth.signOut()
        } catch (err) {
            console.error('Supabase signOut error:', err)
        } finally {
            clearTimeout(timeout)
            clearClientSession()
            setUser(null)
            setProfile(null)
            setEmployee(null)
            setSession(null)
        }
    }

    const value: AuthContextType = {
        user,
        profile,
        employee,
        session,
        isLoading,
        isAdmin: profile?.role === 'admin',
        isEmployee: profile?.role === 'employee',
        signIn,
        signOut,
        refreshProfile,
    }

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
    const context = useContext(AuthContext)
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider')
    }
    return context
}
