'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import {
    useAdminStats,
    useAttendance,
    useEvents,
    useSchedules,
} from '@/lib/hooks/useData'
import { getTodayNY, getDateNY } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import AssistantTeaser from '@/components/AssistantTeaser'

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

interface AttendanceRow {
    id: string
    employee_id: string
    clock_in: string
    clock_out: string | null
    employees?: { display_name?: string | null; position?: string | null } | null
}

interface ScheduleRow {
    id: string
    employee_id: string
    schedule_date: string
    start_time: string
    end_time: string
    title?: string | null
    location?: string | null
    status: string
    cancellation_reason?: string | null
    employee?: { display_name?: string | null } | null
}

interface EventRow {
    id: string
    title: string
    start_time: string
    end_time: string
    room?: string | null
    expected_headcount?: number | null
    event_staff_assignments?: Array<{
        id: string
        role?: string | null
        employees?: { id: string; display_name?: string | null } | null
    }>
}

function greeting(): string {
    const hour = new Date().toLocaleString('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric',
        hour12: false,
    })
    const h = parseInt(hour, 10)
    if (h < 5) return 'Good evening'
    if (h < 12) return 'Good morning'
    if (h < 17) return 'Good afternoon'
    return 'Good evening'
}

function fmtTime(iso: string): string {
    return new Date(iso).toLocaleTimeString('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    })
}

function fmtTimeFromHHMMSS(t: string): string {
    const [h, m] = t.split(':')
    const hour = parseInt(h, 10)
    const ampm = hour >= 12 ? 'PM' : 'AM'
    const h12 = hour % 12 === 0 ? 12 : hour % 12
    return `${h12}:${m} ${ampm}`
}

function fmtDayOfWeek(dateStr: string): string {
    return new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
    })
}

function elapsed(iso: string): string {
    const ms = Date.now() - new Date(iso).getTime()
    const m = Math.floor(ms / 60000)
    if (m < 1) return 'just now'
    if (m < 60) return `${m}m`
    const h = Math.floor(m / 60)
    const rem = m % 60
    return rem ? `${h}h ${rem}m` : `${h}h`
}

function initials(name?: string | null): string {
    if (!name) return '?'
    const parts = name.trim().split(/\s+/)
    return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?'
}

const AVATAR_COLORS = [
    'bg-blue-500',
    'bg-emerald-500',
    'bg-amber-500',
    'bg-rose-500',
    'bg-violet-500',
    'bg-cyan-500',
    'bg-fuchsia-500',
    'bg-orange-500',
]

function avatarColor(seed: string): string {
    let h = 0
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
    return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}

function Avatar({ name, size = 'sm' }: { name?: string | null; size?: 'sm' | 'md' }) {
    const cls = size === 'md' ? 'w-9 h-9 text-sm' : 'w-7 h-7 text-[10px]'
    return (
        <div
            className={`${cls} ${avatarColor(name || '?')} rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0`}
            title={name || ''}
        >
            {initials(name)}
        </div>
    )
}

function ProgressRing({
    pct,
    size = 110,
    stroke = 10,
    label,
    sublabel,
}: {
    pct: number
    size?: number
    stroke?: number
    label?: string
    sublabel?: string
}) {
    const r = (size - stroke) / 2
    const c = 2 * Math.PI * r
    const safe = Math.max(0, Math.min(100, Math.round(pct)))
    const offset = c - (safe / 100) * c
    return (
        <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
            <svg width={size} height={size} className="-rotate-90">
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={r}
                    stroke="currentColor"
                    strokeWidth={stroke}
                    fill="none"
                    className="text-muted/40"
                />
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={r}
                    stroke="currentColor"
                    strokeWidth={stroke}
                    fill="none"
                    strokeLinecap="round"
                    strokeDasharray={c}
                    strokeDashoffset={offset}
                    className="text-primary transition-all duration-700"
                />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold leading-none">{safe}%</span>
                {sublabel && <span className="text-[10px] text-muted-foreground mt-1">{sublabel}</span>}
            </div>
            {label && (
                <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-xs text-muted-foreground whitespace-nowrap">
                    {label}
                </span>
            )}
        </div>
    )
}

interface KpiCard {
    title: string
    value: number
    icon: string
    href: string
    accent: string
    bg: string
    sub?: string
}

function StatCard({ card }: { card: KpiCard }) {
    return (
        <Link
            href={card.href}
            className="group relative overflow-hidden rounded-2xl border bg-card hover:shadow-lg transition-all hover:-translate-y-0.5"
        >
            <div className={`absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity ${card.bg}`} />
            <div className="relative p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                        <p className="text-xs sm:text-sm font-medium text-muted-foreground">{card.title}</p>
                        <p className="text-2xl sm:text-3xl font-bold mt-1 tabular-nums">{card.value}</p>
                        {card.sub && (
                            <p className="text-[11px] text-muted-foreground mt-1 truncate">{card.sub}</p>
                        )}
                    </div>
                    <div
                        className={`w-10 h-10 sm:w-11 sm:h-11 rounded-xl ${card.accent} flex items-center justify-center text-lg sm:text-xl flex-shrink-0 group-hover:scale-110 transition-transform`}
                    >
                        {card.icon}
                    </div>
                </div>
            </div>
        </Link>
    )
}

function firstName(full?: string | null): string {
    if (!full) return ''
    return full.trim().split(/\s+/)[0] || ''
}

export default function AdminDashboard() {
    const today = getTodayNY()
    const { profile, employee, isSuperAdmin, isScopedAdmin } = useAuth()
    const dashboardTitle = isSuperAdmin
        ? 'Super Admin Dashboard'
        : isScopedAdmin
            ? 'Location Admin Dashboard'
            : 'Admin Dashboard'
    const adminFirstName = firstName(employee?.display_name || profile?.full_name)
    const { data: stats = defaultStats, isLoading: statsLoading, error } = useAdminStats()
    const { data: attendance = [] } = useAttendance(today) as { data: AttendanceRow[] | undefined }
    const { data: upcomingEvents = [] } = useEvents('upcoming') as { data: EventRow[] | undefined }
    const { data: todaySchedules = [] } = useSchedules({ startDate: today, endDate: today }) as {
        data: ScheduleRow[] | undefined
    }
    // Only surface recent cancellation requests (last 30 days); stale ones from
    // long-past shifts should drop off the dashboard.
    const { data: cancellationRequests = [] } = useSchedules({ status: 'cancellation_requested', startDate: getDateNY(-30) }) as {
        data: ScheduleRow[] | undefined
    }
    const { data: pendingConfirmations = [] } = useSchedules({ status: 'pending', startDate: today }) as {
        data: ScheduleRow[] | undefined
    }

    const clockedInNow = useMemo<AttendanceRow[]>(
        () => attendance.filter((a) => !a.clock_out).sort((a, b) => b.clock_in.localeCompare(a.clock_in)),
        [attendance],
    )

    const completedTodayShifts = useMemo<AttendanceRow[]>(
        () => attendance.filter((a) => a.clock_out),
        [attendance],
    )

    const completionPct = useMemo(() => {
        const total = stats.tasks_completed_today + stats.tasks_pending_today
        return total > 0 ? Math.round((stats.tasks_completed_today / total) * 100) : 0
    }, [stats.tasks_completed_today, stats.tasks_pending_today])

    const attendanceRatePct = useMemo(() => {
        if (!stats.active_employees) return 0
        return Math.round((stats.clocked_in_today / stats.active_employees) * 100)
    }, [stats.clocked_in_today, stats.active_employees])

    const next3Events = upcomingEvents.slice(0, 3)
    const todayConfirmedSchedules = todaySchedules.filter(
        (s) => s.status === 'confirmed' || s.status === 'completed',
    )
    const attentionItems = cancellationRequests.length + pendingConfirmations.length

    const statCards: KpiCard[] = [
        {
            title: 'Active Employees',
            value: stats.active_employees,
            icon: '👥',
            href: '/admin/employees',
            accent: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
            bg: 'bg-gradient-to-br from-blue-500/5 to-transparent',
            sub: stats.active_employees ? `${stats.clocked_in_today} clocked in today` : undefined,
        },
        {
            title: 'On Shift Now',
            value: clockedInNow.length,
            icon: '⏰',
            href: '/admin/attendance',
            accent: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
            bg: 'bg-gradient-to-br from-emerald-500/5 to-transparent',
            sub: completedTodayShifts.length ? `${completedTodayShifts.length} shifts ended today` : 'live count',
        },
        {
            title: 'Tasks Today',
            value: stats.tasks_completed_today + stats.tasks_pending_today,
            icon: '✅',
            href: '/admin/tasks',
            accent: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
            bg: 'bg-gradient-to-br from-violet-500/5 to-transparent',
            sub: `${stats.tasks_completed_today} done · ${stats.tasks_pending_today} pending`,
        },
        {
            title: 'Events This Week',
            value: stats.events_this_week,
            icon: '🎉',
            href: '/admin/events',
            accent: 'bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400',
            bg: 'bg-gradient-to-br from-fuchsia-500/5 to-transparent',
            sub: stats.events_today ? `${stats.events_today} today` : 'upcoming',
        },
        {
            title: 'Pending Confirms',
            value: pendingConfirmations.length,
            icon: '📋',
            href: '/admin/schedules',
            accent: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
            bg: 'bg-gradient-to-br from-amber-500/5 to-transparent',
            sub: pendingConfirmations.length ? 'awaiting employee' : 'all confirmed',
        },
        {
            title: 'Cancel Requests',
            value: cancellationRequests.length,
            icon: '🚨',
            href: '/admin/schedules',
            accent: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
            bg: 'bg-gradient-to-br from-rose-500/5 to-transparent',
            sub: cancellationRequests.length ? 'needs review' : 'all clear',
        },
    ]

    if (statsLoading) {
        return (
            <div className="animate-pulse space-y-6">
                <div className="h-10 bg-muted rounded w-72"></div>
                <div className="h-20 bg-muted rounded-2xl"></div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {[...Array(6)].map((_, i) => (
                        <div key={i} className="h-28 bg-muted rounded-2xl"></div>
                    ))}
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {[...Array(3)].map((_, i) => (
                        <div key={i} className="h-64 bg-muted rounded-2xl"></div>
                    ))}
                </div>
            </div>
        )
    }

    if (error) {
        return (
            <div className="p-4 bg-destructive/10 text-destructive rounded-lg">
                {String(error)}
            </div>
        )
    }

    return (
        <div className="space-y-5 sm:space-y-6">
            {/* Hero */}
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
                <div>
                    <p className="text-xs sm:text-sm font-medium text-muted-foreground tracking-wide uppercase">
                        {greeting()}{adminFirstName ? `, ${adminFirstName}` : ''} · {fmtDayOfWeek(today)}
                    </p>
                    <h1 className="text-2xl sm:text-4xl font-bold mt-1 bg-gradient-to-r from-indigo-600 via-fuchsia-600 to-amber-500 bg-clip-text text-transparent">
                        {dashboardTitle}
                    </h1>
                    <p className="text-muted-foreground mt-1 text-sm">
                        Live operations overview — refreshes automatically.
                    </p>
                </div>
                {attentionItems > 0 && (
                    <Link
                        href="/admin/schedules"
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 text-sm font-medium hover:bg-rose-500/20 transition-colors"
                    >
                        <span className="relative flex h-2 w-2">
                            <span className="absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75 animate-ping" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500" />
                        </span>
                        {attentionItems} item{attentionItems === 1 ? '' : 's'} need attention
                    </Link>
                )}
            </div>

            {/* KPI grid — headline numbers (Active Employees pinned first) */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
                {statCards.map((c) => (
                    <StatCard key={c.title} card={c} />
                ))}
            </div>

            {/* Needs Attention — action items right after stats */}
            <div className="rounded-2xl border bg-card overflow-hidden">
                <div className="flex items-center justify-between p-4 sm:p-5 border-b">
                    <div className="flex items-center gap-2">
                        <span className="text-lg">🔔</span>
                        <h2 className="font-semibold text-base sm:text-lg">Needs Attention</h2>
                        {attentionItems > 0 && (
                            <span className="ml-1 px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 text-xs font-semibold tabular-nums">
                                {attentionItems}
                            </span>
                        )}
                    </div>
                    <Link href="/admin/schedules" className="text-xs sm:text-sm text-primary hover:underline">
                        View all →
                    </Link>
                </div>
                {attentionItems === 0 ? (
                    <div className="p-6 text-center text-sm text-muted-foreground">
                        <div className="text-2xl mb-1">✨</div>
                        All clear — nothing waiting on you.
                    </div>
                ) : (
                    <ul className="divide-y">
                        {cancellationRequests.slice(0, 5).map((s) => (
                            <li key={s.id} className="flex items-center gap-3 p-3 sm:px-5">
                                <span className="w-8 h-8 rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center text-base flex-shrink-0">
                                    🚨
                                </span>
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm">
                                        <span className="font-medium">{s.employee?.display_name || 'Employee'}</span>{' '}
                                        requested cancellation —{' '}
                                        <span className="text-muted-foreground">
                                            {fmtDayOfWeek(s.schedule_date)} {fmtTimeFromHHMMSS(s.start_time)}
                                        </span>
                                    </p>
                                    {s.cancellation_reason && (
                                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                                            &ldquo;{s.cancellation_reason}&rdquo;
                                        </p>
                                    )}
                                </div>
                                <Link
                                    href="/admin/schedules"
                                    className="text-xs text-primary hover:underline flex-shrink-0"
                                >
                                    Review
                                </Link>
                            </li>
                        ))}
                        {pendingConfirmations.slice(0, 5).map((s) => (
                            <li key={s.id} className="flex items-center gap-3 p-3 sm:px-5">
                                <span className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center text-base flex-shrink-0">
                                    📋
                                </span>
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm">
                                        <span className="font-medium">{s.employee?.display_name || 'Employee'}</span>{' '}
                                        hasn&apos;t confirmed —{' '}
                                        <span className="text-muted-foreground">
                                            {fmtDayOfWeek(s.schedule_date)} {fmtTimeFromHHMMSS(s.start_time)}
                                        </span>
                                    </p>
                                </div>
                                <Link
                                    href="/admin/schedules"
                                    className="text-xs text-primary hover:underline flex-shrink-0"
                                >
                                    Nudge
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <AssistantTeaser />

            {/* Row 1: Live attendance + task ring */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5">
                {/* Live attendance */}
                <div className="lg:col-span-2 rounded-2xl border bg-card overflow-hidden">
                    <div className="flex items-center justify-between p-4 sm:p-5 border-b">
                        <div className="flex items-center gap-2">
                            <div className="relative flex h-2 w-2">
                                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                            </div>
                            <h2 className="font-semibold text-base sm:text-lg">On Shift Right Now</h2>
                            <span className="text-xs text-muted-foreground">({clockedInNow.length})</span>
                        </div>
                        <Link href="/admin/attendance" className="text-xs sm:text-sm text-primary hover:underline">
                            View all →
                        </Link>
                    </div>
                    <div className="max-h-[320px] overflow-y-auto">
                        {clockedInNow.length === 0 ? (
                            <div className="p-8 text-center text-sm text-muted-foreground">
                                <div className="text-3xl mb-2">🌙</div>
                                Nobody is clocked in right now.
                            </div>
                        ) : (
                            <ul className="divide-y">
                                {clockedInNow.map((row) => (
                                    <li key={row.id} className="flex items-center gap-3 p-3 sm:px-5 hover:bg-accent/50 transition-colors">
                                        <Avatar name={row.employees?.display_name} size="md" />
                                        <div className="min-w-0 flex-1">
                                            <p className="font-medium text-sm truncate">
                                                {row.employees?.display_name || 'Unknown'}
                                            </p>
                                            <p className="text-xs text-muted-foreground truncate">
                                                {row.employees?.position || 'Staff'} · since {fmtTime(row.clock_in)}
                                            </p>
                                        </div>
                                        <span className="text-xs font-medium tabular-nums px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                                            {elapsed(row.clock_in)}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>

                {/* Task progress + attendance */}
                <div className="rounded-2xl border bg-card p-4 sm:p-5 flex flex-col">
                    <h2 className="font-semibold text-base sm:text-lg mb-4">Today&apos;s Health</h2>
                    <div className="flex-1 grid grid-cols-2 gap-4 items-center justify-items-center">
                        <div className="flex flex-col items-center gap-7">
                            <ProgressRing pct={completionPct} sublabel="tasks" />
                            <span className="text-xs text-muted-foreground">Task completion</span>
                        </div>
                        <div className="flex flex-col items-center gap-7">
                            <ProgressRing pct={attendanceRatePct} sublabel="staff" />
                            <span className="text-xs text-muted-foreground">Attendance</span>
                        </div>
                    </div>
                    <div className="mt-5 pt-4 border-t space-y-2 text-xs sm:text-sm">
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Tasks done</span>
                            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                                {stats.tasks_completed_today}
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Tasks pending</span>
                            <span className="font-semibold text-amber-600 dark:text-amber-400">
                                {stats.tasks_pending_today}
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">On shift</span>
                            <span className="font-semibold">
                                {clockedInNow.length} / {stats.active_employees}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Row 2: Today's schedule + Upcoming events */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
                {/* Today's schedule */}
                <div className="rounded-2xl border bg-card overflow-hidden">
                    <div className="flex items-center justify-between p-4 sm:p-5 border-b">
                        <h2 className="font-semibold text-base sm:text-lg">Today&apos;s Schedule</h2>
                        <Link href="/admin/schedules" className="text-xs sm:text-sm text-primary hover:underline">
                            View all →
                        </Link>
                    </div>
                    <div className="max-h-[360px] overflow-y-auto">
                        {todayConfirmedSchedules.length === 0 ? (
                            <div className="p-8 text-center text-sm text-muted-foreground">
                                <div className="text-3xl mb-2">📅</div>
                                No shifts scheduled today.
                            </div>
                        ) : (
                            <ul className="divide-y">
                                {todayConfirmedSchedules
                                    .sort((a, b) => a.start_time.localeCompare(b.start_time))
                                    .map((s) => {
                                        const isCompleted = s.status === 'completed'
                                        return (
                                            <li
                                                key={s.id}
                                                className="flex items-center gap-3 p-3 sm:px-5 hover:bg-accent/50 transition-colors"
                                            >
                                                <div className="flex-shrink-0 w-14 sm:w-16 text-center">
                                                    <p className="text-[11px] text-muted-foreground leading-tight">
                                                        {fmtTimeFromHHMMSS(s.start_time)}
                                                    </p>
                                                    <p className="text-[10px] text-muted-foreground/70">to</p>
                                                    <p className="text-[11px] font-medium leading-tight">
                                                        {fmtTimeFromHHMMSS(s.end_time)}
                                                    </p>
                                                </div>
                                                <div className="w-px self-stretch bg-border" />
                                                <Avatar name={s.employee?.display_name} />
                                                <div className="min-w-0 flex-1">
                                                    <p className="font-medium text-sm truncate">
                                                        {s.employee?.display_name || 'Unknown'}
                                                    </p>
                                                    {s.title && (
                                                        <p className="text-xs text-muted-foreground truncate">
                                                            {s.title}
                                                            {s.location && ` · ${s.location}`}
                                                        </p>
                                                    )}
                                                </div>
                                                <span
                                                    className={`text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded-full ${
                                                        isCompleted
                                                            ? 'bg-muted text-muted-foreground'
                                                            : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                                    }`}
                                                >
                                                    {isCompleted ? 'done' : 'on'}
                                                </span>
                                            </li>
                                        )
                                    })}
                            </ul>
                        )}
                    </div>
                </div>

                {/* Upcoming events */}
                <div className="rounded-2xl border bg-card overflow-hidden">
                    <div className="flex items-center justify-between p-4 sm:p-5 border-b">
                        <h2 className="font-semibold text-base sm:text-lg">Upcoming Events</h2>
                        <Link href="/admin/events" className="text-xs sm:text-sm text-primary hover:underline">
                            View all →
                        </Link>
                    </div>
                    {next3Events.length === 0 ? (
                        <div className="p-8 text-center text-sm text-muted-foreground">
                            <div className="text-3xl mb-2">🎉</div>
                            No upcoming events.
                        </div>
                    ) : (
                        <ul className="divide-y">
                            {next3Events.map((e) => {
                                const staff = e.event_staff_assignments || []
                                return (
                                    <li key={e.id} className="p-3 sm:p-5 hover:bg-accent/50 transition-colors">
                                        <div className="flex items-start gap-3">
                                            <div className="flex-shrink-0 text-center w-12 rounded-lg border bg-background p-1.5">
                                                <p className="text-[10px] uppercase text-muted-foreground leading-none">
                                                    {new Date(e.start_time).toLocaleString('en-US', {
                                                        timeZone: 'America/New_York',
                                                        month: 'short',
                                                    })}
                                                </p>
                                                <p className="text-lg font-bold leading-tight">
                                                    {new Date(e.start_time).toLocaleString('en-US', {
                                                        timeZone: 'America/New_York',
                                                        day: 'numeric',
                                                    })}
                                                </p>
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="font-semibold text-sm truncate">{e.title}</p>
                                                <p className="text-xs text-muted-foreground mt-0.5">
                                                    {fmtTime(e.start_time)} – {fmtTime(e.end_time)}
                                                    {e.room && ` · ${e.room}`}
                                                    {e.expected_headcount ? ` · ${e.expected_headcount} guests` : ''}
                                                </p>
                                                {staff.length > 0 && (
                                                    <div className="flex items-center gap-1.5 mt-2">
                                                        <div className="flex -space-x-2">
                                                            {staff.slice(0, 4).map((sa) => (
                                                                <div key={sa.id} className="ring-2 ring-card rounded-full">
                                                                    <Avatar name={sa.employees?.display_name} />
                                                                </div>
                                                            ))}
                                                        </div>
                                                        <span className="text-[11px] text-muted-foreground ml-1">
                                                            {staff.length} staff
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </li>
                                )
                            })}
                        </ul>
                    )}
                </div>
            </div>

            {/* Row 3: Quick actions (full width) */}
            <div className="rounded-2xl border bg-card p-4 sm:p-5">
                <h2 className="font-semibold text-base sm:text-lg mb-3">Quick Actions</h2>
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 sm:gap-3">
                    {[
                        { href: '/admin/employees', label: 'Employees', icon: '👥' },
                        { href: '/admin/schedules', label: 'Schedules', icon: '📅' },
                        { href: '/admin/tasks', label: 'Tasks', icon: '✅' },
                        { href: '/admin/events', label: 'Events', icon: '🎉' },
                        { href: '/admin/attendance', label: 'Attendance', icon: '⏰' },
                        { href: '/admin/reports', label: 'Reports', icon: '📈' },
                        { href: '/admin/onboarding', label: 'Onboarding', icon: '📚' },
                        { href: '/admin/policies', label: 'Important Messages', icon: '📋' },
                    ].map((a) => (
                        <Link
                            key={a.href}
                            href={a.href}
                            className="flex flex-col items-center justify-center gap-1 p-3 sm:p-4 rounded-xl border bg-background hover:bg-accent transition-colors group"
                        >
                            <span className="text-xl sm:text-2xl group-hover:scale-110 transition-transform">{a.icon}</span>
                            <span className="text-xs font-medium">{a.label}</span>
                        </Link>
                    ))}
                </div>
            </div>
        </div>
    )
}
