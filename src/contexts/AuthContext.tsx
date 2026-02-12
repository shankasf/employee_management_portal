'use client'

import { createContext, useContext, useEffect, useState, useRef, useCallback, ReactNode } from 'react'
import { createClient } from '@/lib/supabase/client'
import { User, Session } from '@supabase/supabase-js'
import { Tables } from '@/types/supabase'

// Suppress Supabase warnings on client side
if (typeof window !== 'undefined') {
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    const msg = String(args[0] || '');
    if (msg.includes('Using the user object as returned from')) return;
    if (msg.includes('Node.js 18 and below are deprecated')) return;
    originalWarn.apply(console, args);
  };
}

// PERFORMANCE: Only log in development
const isDev = process.env.NODE_ENV === 'development';

// Client-side logging helper (disabled in production)
const log = (area: string, message: string, data?: Record<string, unknown>) => {
  if (!isDev || typeof window === 'undefined') return;
  const ts = new Date().toISOString().split('T')[1].slice(0, 12);
  const dataStr = data ? ` | ${JSON.stringify(data)}` : '';
  console.log(`%c[${ts}] [Auth:${area}] ${message}${dataStr}`, 'color: #4CAF50');
};

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
        if (isFetchingRef.current) {
            log('fetchProfile', 'Skipped - already fetching');
            return;
        }
        if (!force && fetchedUserIdRef.current === userId) {
            log('fetchProfile', 'Skipped - already fetched for user', { userId });
            return;
        }

        log('fetchProfile', 'Starting', { userId, force });
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
                    log('fetchProfile', 'Profile error', { error: profileError.message });
                } else if (profileData) {
                    const p = profileData as Profile;
                    log('fetchProfile', 'Profile loaded', { email: p.email, role: p.role });
                    setProfile(p)
                }
            } else {
                log('fetchProfile', 'Profile fetch failed', { reason: String(profileResult.reason) });
            }

            if (employeeResult.status === 'fulfilled') {
                const { data: employeeData, error: employeeError } = employeeResult.value
                if (employeeError) {
                    log('fetchProfile', 'Employee error (may be normal for admins)', { error: employeeError.message });
                } else if (employeeData) {
                    const e = employeeData as Employee;
                    log('fetchProfile', 'Employee loaded', { name: e.display_name });
                    setEmployee(e)
                }
            } else {
                log('fetchProfile', 'Employee fetch failed', { reason: String(employeeResult.reason) });
            }

            // Mark as fetched for this user
            fetchedUserIdRef.current = userId
            log('fetchProfile', 'Complete');
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
        let initAuthCompleted = false
        log('useEffect', 'AuthProvider mounted');

        // FIX: Use onAuthStateChange as the PRIMARY source of auth state
        // This handles page refresh correctly with cookies
        // IMPORTANT: Supabase docs recommend avoiding async callbacks to prevent deadlocks
        // Use setTimeout(..., 0) to defer async operations
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            (event, session) => {
                log('onAuthStateChange', `Event: ${event}`, { hasSession: !!session, email: session?.user?.email });
                if (!mounted) return

                // Handle INITIAL_SESSION - this is the main event on page refresh
                // "Emitted right after the Supabase client is constructed and the initial session from storage is loaded"
                if (event === 'INITIAL_SESSION') {
                    log('onAuthStateChange', 'INITIAL_SESSION received');
                    initAuthCompleted = true
                    if (session?.user) {
                        setSession(session)
                        setUser(session.user)
                        // SUPABASE BEST PRACTICE: Defer async operations with setTimeout to prevent deadlocks
                        setTimeout(() => {
                            if (mounted) {
                                fetchProfile(session.user.id).finally(() => {
                                    if (mounted) setIsLoading(false)
                                })
                            }
                        }, 0)
                    } else {
                        setSession(null)
                        setUser(null)
                        setIsLoading(false)
                    }
                    return
                }

                // Handle token refresh - update session without fetching profile
                if (event === 'TOKEN_REFRESHED' && session) {
                    log('onAuthStateChange', 'Token refreshed');
                    setSession(session)
                    setUser(session.user)
                    return
                }

                // Handle sign out - clear state (redirect handled by signOut caller)
                if (event === 'SIGNED_OUT') {
                    log('onAuthStateChange', 'Signed out - clearing state');
                    fetchedUserIdRef.current = null
                    setUser(null)
                    setProfile(null)
                    setEmployee(null)
                    setSession(null)
                    setIsLoading(false)
                    // Note: Don't redirect here - let the signOut caller handle redirect
                    // to avoid race conditions with middleware
                    return
                }

                // Handle sign in - defer profile fetch to prevent deadlocks
                if (event === 'SIGNED_IN' && session?.user) {
                    log('onAuthStateChange', 'Signed in');
                    setSession(session)
                    setUser(session.user)
                    setTimeout(() => {
                        if (mounted) {
                            fetchProfile(session.user.id).finally(() => {
                                if (mounted) setIsLoading(false)
                            })
                        }
                    }, 0)
                    return
                }

                // For other events, update session state
                log('onAuthStateChange', 'Other event - updating state');
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

        // Fallback: If onAuthStateChange doesn't fire within 2 seconds, use getSession
        // This handles edge cases where the auth event might not fire
        const fallbackTimer = setTimeout(async () => {
            if (initAuthCompleted || !mounted) return

            log('initAuth', 'Fallback triggered - onAuthStateChange did not fire');
            try {
                const { data: { session: localSession } } = await supabase.auth.getSession()
                log('initAuth', 'getSession result', { hasSession: !!localSession, email: localSession?.user?.email });

                if (!mounted || initAuthCompleted) return

                if (localSession?.user) {
                    setSession(localSession)
                    setUser(localSession.user)
                    await fetchProfile(localSession.user.id)
                } else {
                    setSession(null)
                    setUser(null)
                }
            } catch (error) {
                log('initAuth', 'Error', { error: String(error) });
            } finally {
                if (mounted && !initAuthCompleted) {
                    log('initAuth', 'Fallback complete - setting isLoading=false');
                    setIsLoading(false)
                }
            }
        }, 2000)

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
            clearTimeout(fallbackTimer)
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
        // Clear sb-* cookies set by Supabase auth helpers and middleware cache cookies
        try {
            document.cookie
                .split(';')
                .map((c) => c.split('=')[0]?.trim())
                .filter((name) => name && (
                    name.startsWith('sb-') ||
                    name.toLowerCase().includes('supabase') ||
                    name === 'user_role' ||
                    name === 'user_role_id' ||
                    name === 'session_validated'
                ))
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
