'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { getProfilePicSrc, formatHours } from '@/lib/utils'

type Schedule = {
    id: string
    schedule_date: string
    start_time: string
    end_time: string
    title: string | null
    location: string | null
    status: string
}

type AttendanceLog = {
    id: string
    clock_in: string
    clock_out: string | null
    break_minutes: number | null
    clock_in_location_name: string | null
    clock_out_location_name: string | null
}

type Detail = {
    employee: {
        id: string
        display_name: string | null
        position: string | null
        profile_picture_url: string | null
        is_active: boolean
        created_at: string
        work_location: string | null
        phone_number: string | null
        shift_type: string | null
        shift_start: string | null
        shift_end: string | null
        email: string | null
        full_name: string | null
    }
    weekSchedules: Schedule[]
    upcomingShifts: Schedule[]
    weekHours: { totalMinutes: number; days: { date: string; minutes: number }[]; weekStart: string; weekEnd: string }
    payPeriodHours: { totalMinutes: number; startDate: string; endDate: string }
    recentAttendance: AttendanceLog[]
    workedLocations: { name: string; minutes: number }[]
    openAttendance: AttendanceLog | null
}

const OT_WEEKLY_MINUTES = 40 * 60

interface Props {
    employeeId: string
    onClose: () => void
}

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then(r => {
    if (!r.ok) throw new Error('Failed to load')
    return r.json()
})

function formatDate(s: string) {
    const [y, m, d] = s.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function formatTime(t: string) {
    // schedule times are HH:mm:ss
    const [h, m] = t.split(':').map(Number)
    const period = h >= 12 ? 'PM' : 'AM'
    const hh = h % 12 || 12
    return `${hh}:${String(m).padStart(2, '0')} ${period}`
}

function formatDateTime(iso: string) {
    return new Date(iso).toLocaleString('en-US', {
        timeZone: 'America/New_York',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    })
}

export default function EmployeeDetailPanel({ employeeId, onClose }: Props) {
    const { data, error, isLoading } = useSWR<Detail>(
        `/api/admin/org-chart/employee/${employeeId}`,
        fetcher,
    )

    // Esc to close
    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }, [onClose])

    const emp = data?.employee
    const picUrl = emp ? getProfilePicSrc(emp.profile_picture_url) : null
    const name = emp?.display_name || emp?.full_name || 'Employee'
    const initial = name[0]?.toUpperCase() || '?'

    const weekTotal = data?.weekHours.totalMinutes || 0
    const overtime = Math.max(0, weekTotal - OT_WEEKLY_MINUTES)

    return (
        <div className="fixed inset-0 z-50 flex">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/40"
                onClick={onClose}
                aria-label="Close panel"
            />

            {/* Panel */}
            <div className="ml-auto h-full w-full sm:max-w-md md:max-w-lg bg-card border-l shadow-xl overflow-y-auto relative animate-slide-up sm:animate-none">
                <div className="sticky top-0 z-10 bg-card border-b px-4 py-3 flex items-center justify-between">
                    <h2 className="font-semibold">Employee details</h2>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-1.5 rounded hover:bg-accent"
                        aria-label="Close"
                    >
                        ✕
                    </button>
                </div>

                {isLoading && (
                    <div className="p-6 flex justify-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary" />
                    </div>
                )}
                {error && (
                    <div className="p-6 text-sm text-destructive">Failed to load employee details.</div>
                )}

                {data && emp && (
                    <div className="p-4 space-y-5">
                        {/* Header */}
                        <div className="flex gap-3 items-center">
                            {picUrl ? (
                                /* eslint-disable-next-line @next/next/no-img-element */
                                <img src={picUrl} alt={name} className="w-16 h-16 rounded-full object-cover" />
                            ) : (
                                <div className="w-16 h-16 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-bold text-2xl">
                                    {initial}
                                </div>
                            )}
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    <h3 className="font-bold text-lg truncate">{name}</h3>
                                    <span className={`text-xs px-2 py-0.5 rounded-full ${emp.is_active ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}>
                                        {emp.is_active ? 'Active' : 'Inactive'}
                                    </span>
                                </div>
                                {emp.position && <p className="text-sm text-muted-foreground truncate">{emp.position}</p>}
                                {emp.email && <p className="text-xs text-muted-foreground truncate">{emp.email}</p>}
                                {emp.phone_number && <p className="text-xs text-muted-foreground truncate">{emp.phone_number}</p>}
                            </div>
                        </div>

                        {/* Status now */}
                        <div className="grid grid-cols-2 gap-2">
                            <StatCard
                                label={data.openAttendance ? 'Currently clocked in' : 'Not clocked in'}
                                value={data.openAttendance
                                    ? `${formatDateTime(data.openAttendance.clock_in)}`
                                    : '—'
                                }
                                tone={data.openAttendance ? 'green' : 'muted'}
                            />
                            <StatCard
                                label="Start date"
                                value={new Date(emp.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                tone="muted"
                            />
                        </div>

                        {/* Hours summary */}
                        <Section title="Hours this week" subtitle={`${formatDate(data.weekHours.weekStart)} – ${formatDate(data.weekHours.weekEnd)}`}>
                            <div className="grid grid-cols-7 gap-1 mb-2">
                                {data.weekHours.days.map(d => (
                                    <div key={d.date} className="text-center">
                                        <div className="text-[10px] text-muted-foreground uppercase">
                                            {new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' })[0]}
                                        </div>
                                        <div
                                            className={`mt-1 mx-auto rounded-sm ${d.minutes > 0 ? 'bg-primary' : 'bg-muted'}`}
                                            style={{
                                                height: `${Math.min(40, 4 + (d.minutes / 60) * 4)}px`,
                                                width: '70%',
                                            }}
                                            title={`${formatHours(d.minutes)} on ${d.date}`}
                                        />
                                        <div className="text-[10px] text-muted-foreground mt-0.5">{Math.round(d.minutes / 60)}h</div>
                                    </div>
                                ))}
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Total</span>
                                <span className="font-semibold">{formatHours(weekTotal)}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Overtime (&gt;40h)</span>
                                <span className={overtime > 0 ? 'font-semibold text-orange-600 dark:text-orange-400' : 'text-muted-foreground'}>{formatHours(overtime)}</span>
                            </div>
                        </Section>

                        {/* Pay period */}
                        <Section title="Pay period" subtitle={`${formatDate(data.payPeriodHours.startDate)} – ${formatDate(data.payPeriodHours.endDate)}`}>
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Total hours</span>
                                <span className="font-semibold">{formatHours(data.payPeriodHours.totalMinutes)}</span>
                            </div>
                        </Section>

                        {/* Weekly schedule */}
                        <Section title="This week's schedule">
                            {data.weekSchedules.length === 0 ? (
                                <p className="text-sm text-muted-foreground">No shifts scheduled.</p>
                            ) : (
                                <ul className="space-y-1.5">
                                    {data.weekSchedules.map(s => (
                                        <li key={s.id} className="flex justify-between text-sm border-b last:border-0 pb-1.5">
                                            <span>
                                                <strong>{formatDate(s.schedule_date)}</strong>
                                                {s.location && <span className="text-muted-foreground"> · {s.location}</span>}
                                            </span>
                                            <span className="text-muted-foreground">
                                                {formatTime(s.start_time)} – {formatTime(s.end_time)}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </Section>

                        {/* Upcoming shifts */}
                        <Section title="Upcoming shifts">
                            {data.upcomingShifts.length === 0 ? (
                                <p className="text-sm text-muted-foreground">No upcoming shifts.</p>
                            ) : (
                                <ul className="space-y-1.5">
                                    {data.upcomingShifts.map(s => (
                                        <li key={s.id} className="flex justify-between text-sm border-b last:border-0 pb-1.5">
                                            <span>
                                                <strong>{formatDate(s.schedule_date)}</strong>
                                                {s.location && <span className="text-muted-foreground"> · {s.location}</span>}
                                            </span>
                                            <span className="text-muted-foreground">
                                                {formatTime(s.start_time)} – {formatTime(s.end_time)}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </Section>

                        {/* Recent clock in/out */}
                        <Section title="Recent clock records">
                            {data.recentAttendance.length === 0 ? (
                                <p className="text-sm text-muted-foreground">No records in this period.</p>
                            ) : (
                                <ul className="space-y-1.5">
                                    {data.recentAttendance.map(a => {
                                        const ci = new Date(a.clock_in)
                                        const co = a.clock_out ? new Date(a.clock_out) : null
                                        const minutes = co ? Math.max(0, Math.round((co.getTime() - ci.getTime()) / 60000)) - (a.break_minutes || 0) : null
                                        return (
                                            <li key={a.id} className="text-sm border-b last:border-0 pb-1.5">
                                                <div className="flex justify-between">
                                                    <span>{formatDateTime(a.clock_in)}</span>
                                                    <span className="text-muted-foreground">
                                                        {co ? formatDateTime(a.clock_out!) : 'open'}
                                                    </span>
                                                </div>
                                                <div className="flex justify-between text-xs text-muted-foreground">
                                                    <span>{a.clock_in_location_name || ''}</span>
                                                    <span>
                                                        {minutes !== null ? formatHours(minutes) : ''}
                                                        {a.break_minutes ? ` · ${a.break_minutes}m break` : ''}
                                                    </span>
                                                </div>
                                            </li>
                                        )
                                    })}
                                </ul>
                            )}
                        </Section>

                        {/* Worked locations */}
                        {data.workedLocations.length > 0 && (
                            <Section title="Worked locations (this pay period)">
                                <ul className="space-y-1">
                                    {data.workedLocations.map(l => (
                                        <li key={l.name} className="flex justify-between text-sm">
                                            <span>{l.name}</span>
                                            <span className="text-muted-foreground">{formatHours(l.minutes)}</span>
                                        </li>
                                    ))}
                                </ul>
                            </Section>
                        )}

                        {/* Quick links */}
                        <div className="flex flex-wrap gap-2 pt-2 border-t">
                            <Link href={`/admin/schedules?employee=${emp.id}`} className="btn-outline btn-sm">
                                Open schedules →
                            </Link>
                            <Link href={`/admin/attendance?employee=${emp.id}`} className="btn-outline btn-sm">
                                Open attendance →
                            </Link>
                            <Link href={`/admin/employees?id=${emp.id}`} className="btn-outline btn-sm">
                                Edit profile →
                            </Link>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
    return (
        <div>
            <div className="flex items-baseline justify-between mb-2">
                <h4 className="font-semibold text-sm">{title}</h4>
                {subtitle && <span className="text-[11px] text-muted-foreground">{subtitle}</span>}
            </div>
            <div className="bg-muted/30 rounded-lg p-3 border">{children}</div>
        </div>
    )
}

function StatCard({ label, value, tone }: { label: string; value: string; tone: 'green' | 'muted' }) {
    return (
        <div className={`rounded-lg p-3 border ${tone === 'green' ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' : 'bg-muted/30'}`}>
            <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
            <p className="text-sm font-medium truncate">{value}</p>
        </div>
    )
}
