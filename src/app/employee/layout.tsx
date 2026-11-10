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
import NavIcon, { type NavIconName } from '@/components/pwa/NavIcon'
import InstallAppPrompt from '@/components/pwa/InstallAppPrompt'
import RegisterServiceWorker from '@/components/pwa/RegisterServiceWorker'

interface NavItem {
    name: string
    href: string
    icon: NavIconName
    /** Short label for the mobile tab bar */
    tabLabel?: string
    badgeKey?: 'onboarding' | 'notifications'
}

const employeeNavItems: NavItem[] = [
    { name: 'Dashboard', href: '/employee', icon: 'home', tabLabel: 'Home' },
    { name: 'Notifications', href: '/employee/notifications', icon: 'bell', badgeKey: 'notifications' },
    { name: 'My Schedule', href: '/employee/schedules', icon: 'schedule', tabLabel: 'Schedule' },
    { name: 'My Calendar', href: '/employee/calendar', icon: 'calendar' },
    { name: 'My Time Card', href: '/employee/attendance', icon: 'clock', tabLabel: 'Time Card' },
    { name: 'My Tasks', href: '/employee/tasks', icon: 'tasks', tabLabel: 'Tasks' },
    { name: 'Org Chart', href: '/employee/org-chart', icon: 'org' },
    { name: 'Onboarding', href: '/employee/onboarding', icon: 'onboarding', badgeKey: 'onboarding' },
    { name: 'Knowledge Base', href: '/employee/knowledge', icon: 'knowledge' },
    { name: 'Settings', href: '/employee/settings', icon: 'settings' },
]

// Mobile: the four most-used screens live in the bottom tab bar; everything else is under "More".
// Notifications is reached from the bell in the mobile header.
const tabItems = employeeNavItems.filter((item) => item.tabLabel)
const moreItems = employeeNavItems.filter((item) => !item.tabLabel && item.href !== '/employee/notifications')
moreItems.push({ name: 'Assistant', href: '/employee/assistant', icon: 'assistant' })

const isActive = (pathname: string, href: string) =>
    href === '/employee' ? pathname === href : pathname === href || pathname.startsWith(href + '/')

interface PendingTrainingSummary {
    new_count: number
    in_progress_count: number
    total_pending: number
}

export default function EmployeeLayout({ children }: { children: ReactNode }) {
    const pathname = usePathname()
    const { profile, employee, signOut, isLoading, user, refreshProfile } = useAuth()
    const [moreOpen, setMoreOpen] = useState(false)

    // Realtime pending training count for the Onboarding nav badge.
    // Shares the SWR key with the dashboard so a single fetch serves both.
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

    // Unread notifications badge (shares the SWR cache with the notifications page)
    const { data: notifData } = useSWR<{ unreadCount: number }>(
        user?.id ? '/api/notifications' : null,
        async (url: string) => {
            const res = await fetch(url, { credentials: 'include' })
            if (!res.ok) return { unreadCount: 0 }
            return res.json()
        },
        { refreshInterval: 60000, revalidateOnFocus: true }
    )

    const badgeCounts: Record<NonNullable<NavItem['badgeKey']>, number> = {
        onboarding: pendingTraining?.total_pending ?? 0,
        notifications: notifData?.unreadCount ?? 0,
    }
    const [signingOut, setSigningOut] = useState(false)
    const [loadingTimeout, setLoadingTimeout] = useState(false)
    const [profilePicError, setProfilePicError] = useState(false)
    const [uploadingPic, setUploadingPic] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    // Profile picture: public URL (no signing/expiry needed) with metadata fallback
    const profilePicUrl = useMemo(() => {
        if (employee?.profile_picture_url) {
            return getProfilePicSrc(employee.profile_picture_url)
        }
        return user?.user_metadata?.avatar_url || user?.user_metadata?.picture || null
    }, [employee?.profile_picture_url, user?.user_metadata?.avatar_url, user?.user_metadata?.picture])

    // Log page views when route changes
    useEffect(() => {
        setMoreOpen(false)
        const pageName = employeeNavItems.find(item => item.href === pathname)?.name || pathname
        logPageView(pageName, 'navigation')
    }, [pathname])

    // Add timeout to prevent infinite loading
    useEffect(() => {
        const timer = setTimeout(() => {
            if (isLoading) {
                setLoadingTimeout(true)
            }
        }, 5000) // 5 second timeout
        return () => clearTimeout(timer)
    }, [isLoading])

    // Note: Middleware handles auth redirects - no client-side redirect needed here

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
        setMoreOpen(false)

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

    if (isLoading && !loadingTimeout) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
            </div>
        )
    }

    // Don't render layout if not authenticated
    if (!user) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mx-auto mb-4"></div>
                    <p className="text-muted-foreground">Redirecting to login...</p>
                </div>
            </div>
        )
    }

    const displayName = employee?.display_name || profile?.full_name || 'Employee'
    const initial = displayName[0] || 'E'
    const currentPage = employeeNavItems.find((item) => isActive(pathname, item.href))
    const moreActive = moreItems.some((item) => isActive(pathname, item.href))
    const notifCount = badgeCounts.notifications

    const renderBadge = (count: number, className = '') =>
        count > 0 ? (
            <span
                aria-label={`${count} pending`}
                className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white text-[11px] font-semibold leading-none shadow-sm ${className}`}
            >
                {count > 99 ? '99+' : count}
            </span>
        ) : null

    const avatar = (size: string) =>
        profilePicUrl && !profilePicError ? (
            <img
                src={profilePicUrl}
                alt="Profile"
                className={`${size} rounded-full object-cover`}
                onError={() => setProfilePicError(true)}
            />
        ) : (
            <div className={`${size} rounded-full bg-primary flex items-center justify-center text-primary-foreground font-semibold`}>
                {initial}
            </div>
        )

    const profileBlock = (
        <div className="flex items-center gap-3">
            <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingPic}
                className="relative group flex-shrink-0 rounded-full focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                title="Change profile picture"
            >
                {avatar('w-10 h-10')}
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
                <p className="font-medium truncate text-sm sm:text-base">{displayName}</p>
                <p className="text-xs text-muted-foreground truncate">{employee?.position || 'Staff'}</p>
            </div>
        </div>
    )

    return (
        <div className="app-shell min-h-screen min-h-[100dvh] bg-background">
            <RegisterServiceWorker />
            <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                className="hidden"
                onChange={handleProfilePicUpload}
            />

            {/* Desktop sidebar */}
            <aside className="hidden lg:block fixed inset-y-0 left-0 z-50 w-64 bg-card border-r">
                <div className="flex flex-col h-full">
                    {/* Logo */}
                    <div className="flex items-center h-16 px-4 border-b">
                        <Link href="/employee" className="flex items-center gap-2.5">
                            <img src="/icons/icon-192.png" alt="" className="h-8 w-8 rounded-lg" />
                            <span className="font-bold text-lg">PlayFunia</span>
                        </Link>
                    </div>

                    {/* Navigation */}
                    <nav className="flex-1 overflow-y-auto p-4 space-y-1">
                        {employeeNavItems.map((item) => {
                            const active = isActive(pathname, item.href)
                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    className={`${active ? 'sidebar-link-active' : 'sidebar-link'} relative`}
                                >
                                    <NavIcon name={item.icon} className={`h-5 w-5 ${active ? 'text-primary' : ''}`} />
                                    <span className="flex-1">{item.name}</span>
                                    {item.badgeKey && renderBadge(badgeCounts[item.badgeKey], 'ml-auto')}
                                </Link>
                            )
                        })}
                    </nav>

                    {/* User section */}
                    <div className="border-t p-4">
                        <div className="mb-3">{profileBlock}</div>
                        <button
                            type="button"
                            onClick={handleSignOut}
                            disabled={signingOut}
                            className="btn-ghost w-full justify-start text-sm text-muted-foreground hover:text-destructive disabled:opacity-50"
                        >
                            <NavIcon name="logout" className="h-4 w-4 mr-2" />
                            {signingOut ? 'Signing out...' : 'Sign Out'}
                        </button>
                    </div>
                </div>
            </aside>

            {/* Main content */}
            <div className="lg:pl-64">
                {/* Mobile app header */}
                <header className="sticky top-0 z-30 border-b bg-card/90 backdrop-blur-md lg:hidden safe-top">
                    <div className="flex h-14 items-center gap-3 px-4">
                        <Link href="/employee" className="flex items-center gap-2 min-w-0 flex-1">
                            <img src="/icons/icon-192.png" alt="" className="h-8 w-8 rounded-lg flex-shrink-0" />
                            <span className="font-semibold text-base truncate">
                                {pathname === '/employee' ? 'PlayFunia' : currentPage?.name ?? 'PlayFunia'}
                            </span>
                        </Link>
                        <Link
                            href="/employee/notifications"
                            aria-label={notifCount > 0 ? `Notifications, ${notifCount} unread` : 'Notifications'}
                            className={`relative flex h-11 w-11 items-center justify-center rounded-full hover:bg-accent ${pathname === '/employee/notifications' ? 'text-primary' : ''}`}
                        >
                            <NavIcon name="bell" className="h-6 w-6" />
                            {notifCount > 0 && (
                                <span className="absolute top-1.5 right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-white text-[10px] font-bold leading-[18px] text-center ring-2 ring-card">
                                    {notifCount > 99 ? '99+' : notifCount}
                                </span>
                            )}
                        </Link>
                        <button type="button" onClick={() => setMoreOpen(true)} aria-label="Open profile menu" className="rounded-full">
                            {avatar('w-9 h-9')}
                        </button>
                    </div>
                </header>

                {/* Page content */}
                <main className="px-3 pt-3 sm:px-4 sm:pt-4 lg:p-6 xl:p-8 pb-[calc(var(--app-bottom-offset)+1rem)] lg:pb-6 xl:pb-8">
                    {pathname === '/employee' && <InstallAppPrompt />}
                    {children}
                </main>
            </div>

            {/* Mobile bottom tab bar */}
            <nav
                aria-label="Main"
                className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 backdrop-blur-md lg:hidden"
                style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
            >
                <div className="grid h-16 grid-cols-5">
                    {tabItems.map((item) => {
                        const active = isActive(pathname, item.href)
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                aria-current={active ? 'page' : undefined}
                                className={`relative flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors ${active ? 'text-primary' : 'text-muted-foreground active:text-foreground'}`}
                            >
                                {active && <span className="absolute top-0 h-[3px] w-10 rounded-b-full bg-primary" />}
                                <NavIcon name={item.icon} className="h-6 w-6" strokeWidth={active ? 2.2 : 1.8} />
                                {item.tabLabel}
                            </Link>
                        )
                    })}
                    <button
                        type="button"
                        onClick={() => setMoreOpen(true)}
                        aria-expanded={moreOpen}
                        className={`relative flex flex-col items-center justify-center gap-1 text-[11px] font-medium ${moreActive || moreOpen ? 'text-primary' : 'text-muted-foreground'}`}
                    >
                        {moreActive && <span className="absolute top-0 h-[3px] w-10 rounded-b-full bg-primary" />}
                        <span className="relative">
                            <NavIcon name="more" className="h-6 w-6" strokeWidth={2.2} />
                            {badgeCounts.onboarding > 0 && (
                                <span className="absolute -top-0.5 -right-1 h-2.5 w-2.5 rounded-full bg-purple-600 ring-2 ring-card" />
                            )}
                        </span>
                        More
                    </button>
                </div>
            </nav>

            {/* Mobile "More" sheet */}
            {moreOpen && (
                <div className="fixed inset-0 z-[60] lg:hidden" role="dialog" aria-modal="true" aria-label="More">
                    <div className="absolute inset-0 bg-black/40" onClick={() => setMoreOpen(false)} />
                    <div
                        className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-card shadow-2xl animate-slide-up max-h-[85dvh] overflow-y-auto"
                        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}
                    >
                        <div className="flex justify-center pt-3 pb-1">
                            <span className="h-1.5 w-10 rounded-full bg-muted-foreground/30" />
                        </div>
                        <div className="px-5 pt-2 pb-4 border-b flex items-center gap-3">
                            <div className="flex-1 min-w-0">{profileBlock}</div>
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={uploadingPic}
                                className="flex-shrink-0 h-11 px-2 text-sm font-medium text-primary disabled:opacity-50"
                            >
                                {uploadingPic ? 'Uploading...' : 'Change photo'}
                            </button>
                        </div>
                        <nav className="grid grid-cols-3 gap-2 p-4">
                            {moreItems.map((item) => {
                                const active = isActive(pathname, item.href)
                                const count = item.badgeKey ? badgeCounts[item.badgeKey] : 0
                                return (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        onClick={() => setMoreOpen(false)}
                                        className={`relative flex flex-col items-center justify-center gap-2 rounded-2xl border px-2 py-4 text-center text-xs font-medium transition-colors ${active ? 'border-primary/40 bg-primary/10 text-primary' : 'bg-background active:bg-accent'}`}
                                    >
                                        <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${active ? 'bg-primary text-primary-foreground' : 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300'}`}>
                                            <NavIcon name={item.icon} className="h-6 w-6" />
                                        </span>
                                        {item.name}
                                        {renderBadge(count, 'absolute top-2 right-2')}
                                    </Link>
                                )
                            })}
                        </nav>
                        <div className="px-4">
                            <button
                                type="button"
                                onClick={handleSignOut}
                                disabled={signingOut}
                                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border text-sm font-semibold text-destructive active:bg-destructive/10 disabled:opacity-50"
                            >
                                <NavIcon name="logout" className="h-5 w-5" />
                                {signingOut ? 'Signing out...' : 'Sign Out'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Floating employee assistant — hidden on the full-page route. */}
            {pathname !== '/employee/assistant' && employee && <Chatbot mode="employee" />}
        </div>
    )
}
