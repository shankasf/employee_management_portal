'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { ReactNode, useState, useEffect, useMemo, useRef } from 'react'
import { logPageView, logButtonClick } from '@/lib/usage-log'
import { getPublicProfilePicUrl } from '@/lib/utils'
import { createUntypedClient } from '@/lib/supabase/client'
import { startUpload, logValidationRejection } from '@/lib/upload-logger'

const employeeNavItems = [
    { name: 'Dashboard', href: '/employee', icon: '🏠' },
    { name: 'My Schedule', href: '/employee/schedules', icon: '📅' },
    { name: 'Check-In Tools', href: '/employee/checkin', icon: '📋' },
    { name: 'My Time Card', href: '/employee/attendance', icon: '🕐' },
    { name: 'My Tasks', href: '/employee/tasks', icon: '✅' },
]

export default function EmployeeLayout({ children }: { children: ReactNode }) {
    const pathname = usePathname()
    const { profile, employee, signOut, isLoading, user, refreshProfile } = useAuth()
    const [sidebarOpen, setSidebarOpen] = useState(false)
    const [signingOut, setSigningOut] = useState(false)
    const [loadingTimeout, setLoadingTimeout] = useState(false)
    const [profilePicError, setProfilePicError] = useState(false)
    const [uploadingPic, setUploadingPic] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    // Profile picture: public URL (no signing/expiry needed) with metadata fallback
    const profilePicUrl = useMemo(() => {
        if (employee?.profile_picture_url) {
            return getPublicProfilePicUrl(employee.profile_picture_url)
        }
        return user?.user_metadata?.avatar_url || user?.user_metadata?.picture || null
    }, [employee?.profile_picture_url, user?.user_metadata?.avatar_url, user?.user_metadata?.picture])

    // Log page views when route changes
    useEffect(() => {
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
                        <Link href="/employee" className="flex items-center gap-2">
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
                        {employeeNavItems.map((item) => (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={
                                    pathname === item.href
                                        ? 'sidebar-link-active'
                                        : 'sidebar-link'
                                }
                                onClick={() => setSidebarOpen(false)}
                            >
                                <span className="text-base sm:text-lg">{item.icon}</span>
                                {item.name}
                            </Link>
                        ))}
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
                                        {employee?.display_name?.[0] || profile?.full_name?.[0] || 'E'}
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
                                <p className="font-medium truncate text-sm sm:text-base">
                                    {employee?.display_name || profile?.full_name || 'Employee'}
                                </p>
                                <p className="text-xs text-muted-foreground truncate">
                                    {employee?.position || 'Staff'}
                                </p>
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
                    <span className="font-semibold text-sm sm:text-base">Employee Portal</span>
                </header>

                {/* Page content */}
                <main className="p-3 sm:p-4 lg:p-6 xl:p-8 safe-bottom">{children}</main>
            </div>
        </div>
    )
}
