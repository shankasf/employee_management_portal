'use client'

import Link from 'next/link'
import { useAdminStats } from '@/lib/hooks/useData'

interface DashboardStats {
    active_employees: number
    clocked_in_today: number
    tasks_completed_today: number
    tasks_pending_today: number
    events_today: number
    events_this_week: number
}

const defaultStats: DashboardStats = {
    active_employees: 0,
    clocked_in_today: 0,
    tasks_completed_today: 0,
    tasks_pending_today: 0,
    events_today: 0,
    events_this_week: 0,
}

export default function AdminDashboard() {
    const { data: stats = defaultStats, isLoading: loading, error } = useAdminStats()

    const statCards = [
        {
            title: 'Active Employees',
            value: stats?.active_employees || 0,
            icon: '👥',
            href: '/admin/employees',
            color: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
        },
        {
            title: 'Clocked In Today',
            value: stats?.clocked_in_today || 0,
            icon: '⏰',
            href: '/admin/attendance',
            color: 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400',
        },
        {
            title: 'Tasks Completed',
            value: stats?.tasks_completed_today || 0,
            icon: '✅',
            href: '/admin/tasks',
            color: 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
        },
        {
            title: 'Tasks Pending',
            value: stats?.tasks_pending_today || 0,
            icon: '📝',
            href: '/admin/tasks',
            color: 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-400',
        },
        {
            title: 'Events Today',
            value: stats?.events_today || 0,
            icon: '🎉',
            href: '/admin/events',
            color: 'bg-pink-50 dark:bg-pink-900/20 text-pink-600 dark:text-pink-400',
        },
        {
            title: 'Events This Week',
            value: stats?.events_this_week || 0,
            icon: '📅',
            href: '/admin/events',
            color: 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400',
        },
    ]

    if (loading) {
        return (
            <div className="animate-pulse space-y-6">
                <div className="h-8 bg-muted rounded w-48"></div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {[...Array(6)].map((_, i) => (
                        <div key={i} className="h-32 bg-muted rounded-lg"></div>
                    ))}
                </div>
            </div>
        )
    }

    if (error) {
        return (
            <div className="p-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg">
                {error}
            </div>
        )
    }

    return (
        <div className="space-y-4 sm:space-y-6">
            <div>
                <h1 className="text-2xl sm:text-3xl font-bold">Admin Dashboard</h1>
                <p className="text-muted-foreground mt-1 text-sm sm:text-base">
                    Welcome back! Here&apos;s an overview of today&apos;s operations.
                </p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
                {statCards.map((card) => (
                    <Link
                        key={card.title}
                        href={card.href}
                        className="card hover:shadow-md transition-shadow"
                    >
                        <div className="p-3 sm:p-4 md:p-6">
                            <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                    <p className="text-xs sm:text-sm font-medium text-muted-foreground truncate">
                                        {card.title}
                                    </p>
                                    <p className="text-xl sm:text-2xl md:text-3xl font-bold mt-1">{card.value}</p>
                                </div>
                                <div className={`p-2 sm:p-3 rounded-full ${card.color} flex-shrink-0`}>
                                    <span className="text-lg sm:text-xl md:text-2xl">{card.icon}</span>
                                </div>
                            </div>
                        </div>
                    </Link>
                ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
                {/* Quick Actions */}
                <div className="card">
                    <div className="card-header">
                        <h2 className="card-title text-base sm:text-lg">Quick Actions</h2>
                    </div>
                    <div className="card-content">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                            <Link href="/admin/employees" className="btn-outline text-xs sm:text-sm">
                                👥 Manage Employees
                            </Link>
                            <Link href="/admin/tasks" className="btn-outline text-xs sm:text-sm">
                                ✅ Assign Tasks
                            </Link>
                            <Link href="/admin/events" className="btn-outline text-xs sm:text-sm">
                                🎉 Create Event
                            </Link>
                            <Link href="/admin/attendance" className="btn-outline text-xs sm:text-sm">
                                📊 View Attendance
                            </Link>
                        </div>
                    </div>
                </div>

                {/* Recent Activity Placeholder */}
                <div className="card">
                    <div className="card-header">
                        <h2 className="card-title text-base sm:text-lg">Today&apos;s Summary</h2>
                    </div>
                    <div className="card-content">
                        <div className="space-y-3 sm:space-y-4">
                            <div className="flex items-center justify-between text-sm sm:text-base">
                                <span className="text-muted-foreground">Task Completion Rate</span>
                                <span className="font-semibold">
                                    {stats && (stats.tasks_completed_today + stats.tasks_pending_today) > 0
                                        ? Math.round(
                                            (stats.tasks_completed_today /
                                                (stats.tasks_completed_today + stats.tasks_pending_today)) *
                                            100
                                        )
                                        : 0}
                                    %
                                </span>
                            </div>
                            <div className="w-full bg-muted rounded-full h-2">
                                <div
                                    className="bg-primary h-2 rounded-full transition-all"
                                    style={{
                                        width: `${stats && (stats.tasks_completed_today + stats.tasks_pending_today) > 0
                                            ? (stats.tasks_completed_today /
                                                (stats.tasks_completed_today + stats.tasks_pending_today)) *
                                            100
                                            : 0
                                            }%`,
                                    }}
                                ></div>
                            </div>
                            <div className="pt-3 sm:pt-4 border-t">
                                <p className="text-xs sm:text-sm text-muted-foreground">
                                    {stats?.clocked_in_today || 0} of {stats?.active_employees || 0} employees
                                    currently clocked in
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
