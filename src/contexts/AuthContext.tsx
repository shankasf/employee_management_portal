'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { createClient, createUntypedClient } from '@/lib/supabase/client'
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

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null)
    const [profile, setProfile] = useState<Profile | null>(null)
    const [employee, setEmployee] = useState<Employee | null>(null)
    const [session, setSession] = useState<Session | null>(null)
    const [isLoading, setIsLoading] = useState(true)

    const supabase = createClient()

    const fetchProfile = async (userId: string) => {
        try {
            const db = createUntypedClient()
            const { data: profileData, error: profileError } = await db
                .from('profiles')
                .select('*')
                .eq('id', userId)
                .single()

            if (profileError) {
                console.error('Error fetching profile:', profileError)
            }
            if (profileData) {
                setProfile(profileData as Profile)
            }

            const { data: employeeData, error: employeeError } = await db
                .from('employees')
                .select('*')
                .eq('id', userId)
                .single()

            if (employeeError) {
                console.error('Error fetching employee:', employeeError)
            }
            if (employeeData) {
                setEmployee(employeeData as Employee)
            }
        } catch (err) {
            console.error('Error in fetchProfile:', err)
        }
    }

    const refreshProfile = async () => {
        if (user) {
            await fetchProfile(user.id)
        }
    }

    useEffect(() => {
        const initAuth = async () => {
            try {
                const { data: { session } } = await supabase.auth.getSession()
                setSession(session)
                setUser(session?.user ?? null)

                if (session?.user) {
                    await fetchProfile(session.user.id)
                }
            } catch (error) {
                console.error('Error initializing auth:', error)
            } finally {
                setIsLoading(false)
            }
        }

        initAuth()

        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            async (event, session) => {
                setSession(session)
                setUser(session?.user ?? null)

                if (session?.user) {
                    await fetchProfile(session.user.id)
                } else {
                    setProfile(null)
                    setEmployee(null)
                }

                setIsLoading(false)
            }
        )

        return () => {
            subscription.unsubscribe()
        }
    }, [])

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
