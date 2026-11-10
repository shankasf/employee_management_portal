'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { ReactNode, useState, useEffect, useMemo, useRef } from 'react'
import useSWR from 'swr'
import { logPageView, logButtonClick } from '@/lib/usage-log'
import { getProfilePicSrc } from '@/lib/utils'
import { createUntypedClient } from '@/lib/supabase/client'
import { startUpload, logValidationRejection } from '@/lib/upload-logger'
import Chatbot from '@/components/Chatbot'

// Client-side logging helper
const log = (message: string, data?: Record<string, unknown>) => {
    if (typeof window === 'undefined') return;
    const ts = new Date().toISOString().split('T')[1].slice(0, 12);
    const dataStr = data ? ` | ${JSON.stringify(data)}` : '';
    console.log(`%c[${ts}] [AdminLayout] ${message}${dataStr}`, 'color: #FF9800');
};

interface NavItem {
    name: string
    href: string
    icon: string
    children?: { name: string; href: string; icon: string }[]
}

const adminNavItems: NavItem[] = [
    { name: 'Dashboard', href: '/admin', icon: '📊' },
    { name: 'Notifications', href: '/admin/notifications', icon: '🔔' },
    { name: 'Employees', href: '/admin/employees', icon: '👥' },
    { name: 'Org Chart', href: '/admin/org-chart', icon: '🗂️' },
    {
        name: 'Schedules', href: '/admin/schedules', icon: '📅',
        children: [
            { name: 'Calendar View', href: '/admin/schedule-calendar', icon: '🗓️' },
        ],
    },
    { name: 'Employee Calendar', href: '/admin/employee-calendar', icon: '📆' },
    { name: 'Tasks', href: '/admin/tasks', icon: '✅' },
    { name: 'My Tasks', href: '/admin/my-tasks', icon: '📋' },
    { name: 'Events', href: '/admin/events', icon: '🎉' },
    { name: 'Attendance', href: '/admin/attendance', icon: '⏰' },
    { name: 'Clock In/Out', href: '/admin/clock', icon: '🕓' },
    { name: 'My Attendance', href: '/admin/my-attendance', icon: '📍' },
    { name: 'My Schedule', href: '/admin/my-schedule', icon: '🗓️' },
    { name: 'My Calendar', href: '/admin/my-calendar', icon: '📆' },
    { name: 'Time Card', href: '/admin/timecard', icon: '🕐' },
    { name: 'Reports', href: '/admin/reports', icon: '📈' },
    { name: 'Important Messages', href: '/admin/policies', icon: '📋' },
    {
        name: 'Onboarding', href: '/admin/onboarding', icon: '📚',
        children: [
            { name: 'Progress', href: '/admin/onboarding/progress', icon: '📊' },
        ],
    },
    { name: 'My Onboarding', href: '/admin/my-onboarding', icon: '🎓' },
    {
        name: 'Activity Logs', href: '/admin/activity-logs', icon: '📜',
        children: [
            { name: 'Clock Logs', href: '/admin/clock-debug-logs', icon: '🔍' },
        ],
    },
    { name: 'Settings', href: '/admin/settings', icon: '⚙️' },
]

// Top-level nav hrefs hidden from scoped (location) admins — company-wide sections.
const SCOPED_ADMIN_HIDDEN_HREFS = new Set<string>([
    '/admin/events',
    '/admin/reports',
    '/admin/policies',
    '/admin/activity-logs',
])

export default function AdminLayout({ children }: { children: ReactNode }) {
    const pathname = usePathname()
    const { profile, employee, signOut, isLoading, user, refreshProfile, isScopedAdmin } = useAuth()

    // Scoped admins see a reduced nav (no company-wide sections).
    const visibleNavItems = useMemo(
        () => (isScopedAdmin
            ? adminNavItems.filter((item) => !SCOPED_ADMIN_HIDDEN_HREFS.has(item.href))
            : adminNavItems),
        [isScopedAdmin],
    )
    const [sidebarOpen, setSidebarOpen] = useState(false)
    const [signingOut, setSigningOut] = useState(false)
    const [loadingTimeout, setLoadingTimeout] = useState(false)
    const [profilePicError, setProfilePicError] = useState(false)
    const [uploadingPic, setUploadingPic] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    // Onboarding completion badge (unacknowledged)
    const { data: onboardingBadge } = useSWR<{ count: number }>(
        user && profile?.role === 'admin' ? '/api/admin/onboarding/badge' : null,
        async (url: string) => {
            const res = await fetch(url, { credentials: 'include' })
            if (!res.ok) return { count: 0 }
            return res.json()
        },
        { refreshInterval: 60_000, revalidateOnFocus: true }
    )
    const onboardingCount = onboardingBadge?.count || 0

    // The admin's OWN pending training (admins are employees too).
    const { data: myTraining } = useSWR<{ total_pending: number }>(
        user ? '/api/onboarding/pending' : null,
        async (url: string) => {
            const res = await fetch(url, { credentials: 'include' })
            if (!res.ok) return { total_pending: 0 }
            return res.json()
        },
        { refreshInterval: 60_000, revalidateOnFocus: true }
    )
    const myOnboardingCount = myTraining?.total_pending || 0

    // Unread notifications badge (shares the SWR cache with the notifications page)
    const { data: notifData } = useSWR<{ unreadCount: number }>(
        user ? '/api/notifications' : null,
        async (url: string) => {
            const res = await fetch(url, { credentials: 'include' })
            if (!res.ok) return { unreadCount: 0 }
            return res.json()
        },
        { refreshInterval: 60_000, revalidateOnFocus: true }
    )
    const notifCount = notifData?.unreadCount || 0
    // Profile picture: public URL (no signing/expiry needed) with metadata fallback
    const profilePicUrl = useMemo(() => {
        if (employee?.profile_picture_url) {
            return getProfilePicSrc(employee.profile_picture_url)
        }
        return user?.user_metadata?.avatar_url || user?.user_metadata?.picture || null
    }, [employee?.profile_picture_url, user?.user_metadata?.avatar_url, user?.user_metadata?.picture])

    // Log auth state changes
    useEffect(() => {
        log('Auth state', {
            isLoading,
            hasUser: !!user,
            userId: user?.id,
            hasProfile: !!profile,
            profileEmail: profile?.email,
            profileRole: profile?.role,
            hasEmployee: !!employee,
            displayName: employee?.display_name
        });
    }, [isLoading, user, profile, employee]);

    // Log page views when route changes
    useEffect(() => {
        const pageName = adminNavItems.find(item => item.href === pathname)?.name
            || adminNavItems.flatMap(item => item.children || []).find(c => c.href === pathname)?.name
            || pathname
        logPageView(`Admin: ${pageName}`, 'navigation')
    }, [pathname])

    // Add timeout to prevent infinite loading
    useEffect(() => {
        const timer = setTimeout(() => {
            if (isLoading) {
                log('Loading timeout triggered');
                setLoadingTimeout(true)
            }
        }, 5000) // 5 second timeout
        return () => clearTimeout(timer)
    }, [isLoading])

    // NOTE: Removed client-side redirect - middleware handles auth redirects
    // Client-side redirect was causing a loop with middleware redirects

    const handleProfilePicUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (e.target) e.target.value = ''
        if (!file || !user) return

        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
        if (!allowedTypes.includes(file.type)) {
            logValidationRejection(file, 'Invalid file type', 'self_profile_pic', 'profile-pictures')
            alert('Please select an image file (JPG, PNG, GIF, or WebP).')
            return
        }
        if (file.size > 5 * 1024 * 1024) {
            logValidationRejection(file, 'File too large', 'self_profile_pic', 'profile-pictures')
            alert('Image must be under 5MB.')
            return
        }

        setUploadingPic(true)
        const tracker = startUpload(file, 'profile-pictures', 'self_profile_pic', user.id)
        try {
            const supabase = createUntypedClient()
            const mimeToExt: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' }
            const fileExt = mimeToExt[file.type] || file.name.split('.').pop()?.toLowerCase() || 'jpg'
            const fileName = `profile_${user.id}_${Date.now()}.${fileExt}`

            const { error: uploadError } = await supabase.storage
                .from('profile-pictures')
                .upload(fileName, file, { cacheControl: '3600', upsert: true })

            if (uploadError) {
                tracker.failure(uploadError)
                alert('Failed to upload image. Please try again.')
                return
            }

            tracker.success(fileName)

            const res = await fetch('/api/profile/picture', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ storagePath: fileName }),
            })

            if (!res.ok) {
                alert('Failed to update profile picture. Please try again.')
                return
            }

            setProfilePicError(false)
            await refreshProfile()
        } catch {
            alert('Failed to upload image. Please try again.')
        } finally {
            setUploadingPic(false)
        }
    }

    const handleSignOut = async () => {
        if (signingOut) return
        setSigningOut(true)
        setSidebarOpen(false)

        // Log sign out action
        logButtonClick('Sign Out', 'auth')

        try {
            // Wait for signOut to complete before redirecting to avoid race condition with middleware
            await signOut()
        } catch (err) {
            console.error('Error during sign out:', err)
        } finally {
            setSigningOut(false)
            // Use hard navigation to ensure middleware sees cleared cookies
            window.location.href = '/login'
        }
    }

    // Show loading spinner while auth is initializing AND no user yet
    // Once user is available, render layout even if profile is still loading
    if (!user) {
        // If still loading, show spinner
        if (isLoading && !loadingTimeout) {
            return (
                <div className="min-h-screen flex items-center justify-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
                </div>
            )
        }
        // Not loading and no user - middleware will handle redirect, show brief loading
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
            </div>
        )
    }

    return (
        <div className="min-h-screen min-h-[100dvh] bg-background">
            {/* Mobile sidebar backdrop */}
            {sidebarOpen && (
                <div
                    className="fixed inset-0 z-40 bg-black/50 lg:hidden"
                    onClick={() => setSidebarOpen(false)}
                />
            )}

            {/* Sidebar */}
            <aside
                className={`fixed inset-y-0 left-0 z-50 w-[280px] sm:w-64 bg-card border-r transform transition-transform duration-200 ease-in-out lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'
                    }`}
            >
                <div className="flex flex-col h-full safe-top safe-bottom">
                    {/* Logo */}
                    <div className="flex items-center justify-between h-14 sm:h-16 px-4 border-b">
                        <Link href="/admin" className="flex items-center gap-2">
                            <span className="text-xl sm:text-2xl">🎢</span>
                            <span className="font-bold text-base sm:text-lg">PlayFunia</span>
                        </Link>
                        <button
                            className="lg:hidden p-2 rounded-md hover:bg-accent"
                            onClick={() => setSidebarOpen(false)}
                        >
                            ✕
                        </button>
                    </div>

                    {/* Navigation */}
                    <nav className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-1">
                        {visibleNavItems.map((item) => {
                            const isParentActive = pathname === item.href || (item.children?.some(c => pathname === c.href))
                            return (
                                <div key={item.href}>
                                    <Link
                                        href={item.href}
                                        className={
                                            pathname === item.href
                                                ? 'sidebar-link-active'
                                                : 'sidebar-link'
                                        }
                                        onClick={() => setSidebarOpen(false)}
                                    >
                                        <span className="text-base sm:text-lg">{item.icon}</span>
                                        <span className="flex-1">{item.name}</span>
                                        {item.href === '/admin/onboarding' && onboardingCount > 0 && (
                                            <span className="ml-auto bg-primary text-primary-foreground text-xs font-semibold rounded-full px-2 py-0.5 min-w-[1.25rem] text-center">
                                                {onboardingCount > 99 ? '99+' : onboardingCount}
                                            </span>
                                        )}
                                        {item.href === '/admin/my-onboarding' && myOnboardingCount > 0 && (
                                            <span className="ml-auto bg-primary text-primary-foreground text-xs font-semibold rounded-full px-2 py-0.5 min-w-[1.25rem] text-center">
                                                {myOnboardingCount > 99 ? '99+' : myOnboardingCount}
                                            </span>
                                        )}
                                        {item.href === '/admin/notifications' && notifCount > 0 && (
                                            <span className="ml-auto bg-primary text-primary-foreground text-xs font-semibold rounded-full px-2 py-0.5 min-w-[1.25rem] text-center">
                                                {notifCount > 99 ? '99+' : notifCount}
                                            </span>
                                        )}
                                    </Link>
                                    {item.children && isParentActive && (
                                        <div className="ml-7 mt-1 space-y-1">
                                            {item.children.map((child) => (
                                                <Link
                                                    key={child.href}
                                                    href={child.href}
                                                    className={`block text-sm py-1.5 px-3 rounded-md transition-colors ${
                                                        pathname === child.href
                                                            ? 'bg-accent text-accent-foreground font-medium'
                                                            : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                                                    }`}
                                                    onClick={() => setSidebarOpen(false)}
                                                >
                                                    <span className="mr-2 text-sm">{child.icon}</span>
                                                    {child.name}
                                                </Link>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </nav>

                    {/* User section */}
                    <div className="border-t p-3 sm:p-4">
                        <div className="flex items-center gap-3 mb-3">
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/jpeg,image/png,image/gif,image/webp"
                                className="hidden"
                                onChange={handleProfilePicUpload}
                            />
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={uploadingPic}
                                className="relative group flex-shrink-0 rounded-full focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                                title="Change profile picture"
                            >
                                {profilePicUrl && !profilePicError ? (
                                    <img
                                        src={profilePicUrl}
                                        alt="Profile"
                                        className="w-9 h-9 sm:w-10 sm:h-10 rounded-full object-cover"
                                        onError={() => setProfilePicError(true)}
                                    />
                                ) : (
                                    <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-semibold text-sm sm:text-base">
                                        {(employee?.display_name || profile?.full_name)?.[0] || 'A'}
                                    </div>
                                )}
                                {uploadingPic ? (
                                    <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center">
                                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    </div>
                                ) : (
                                    <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                                    </div>
                                )}
                            </button>
                            <div className="flex-1 min-w-0">
                                <p className="font-medium truncate text-sm sm:text-base">{employee?.display_name || profile?.full_name || 'Admin'}</p>
                                <p className="text-xs text-muted-foreground truncate">{profile?.email}</p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={handleSignOut}
                            disabled={signingOut}
                            className="btn-ghost w-full justify-start text-sm text-muted-foreground hover:text-destructive disabled:opacity-50"
                        >
                            <span className="mr-2">🚪</span>
                            {signingOut ? 'Signing out...' : 'Sign Out'}
                        </button>
                    </div>
                </div>
            </aside>

            {/* Main content */}
            <div className="lg:pl-64">
                {/* Mobile header */}
                <header className="sticky top-0 z-30 flex h-14 sm:h-16 items-center gap-4 border-b bg-card px-4 lg:hidden safe-top">
                    <button
                        className="p-2 rounded-md hover:bg-accent -ml-2"
                        onClick={() => setSidebarOpen(true)}
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="24"
                            height="24"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <line x1="3" y1="12" x2="21" y2="12" />
                            <line x1="3" y1="6" x2="21" y2="6" />
                            <line x1="3" y1="18" x2="21" y2="18" />
                        </svg>
                    </button>
                    <span className="font-semibold text-sm sm:text-base">Admin Portal</span>
                </header>

                {/* Page content */}
                <main className="p-3 sm:p-4 lg:p-6 xl:p-8 safe-bottom">{children}</main>
            </div>

            {/* Floating admin assistant — hidden on the dedicated full-page route
             * (which renders an inline copy of the same component). */}
            {pathname !== '/admin/assistant' && profile?.role === 'admin' && <Chatbot mode="admin" />}
        </div>
    )
}
