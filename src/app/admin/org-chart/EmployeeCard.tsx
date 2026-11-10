'use client'

import { useRef, useState } from 'react'
import { getProfilePicSrc, formatHours } from '@/lib/utils'
import type { EmployeeLite } from './types'

export type LiveStatus = {
    openClockIn: string | null
    todayShift: { start_time: string; end_time: string; location: string | null } | null
    weekMinutes: number
}

interface Props {
    employee: EmployeeLite
    locationName?: string | null
    live?: LiveStatus | null
    onClick: () => void
}

function formatTime(t: string) {
    const [h, m] = t.split(':').map(Number)
    const period = h >= 12 ? 'PM' : 'AM'
    const hh = h % 12 || 12
    return `${hh}:${String(m).padStart(2, '0')} ${period}`
}

function formatClockInTime(iso: string) {
    return new Date(iso).toLocaleTimeString('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric',
        minute: '2-digit',
    })
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Format a YYYY-MM-DD date of birth as "Mar 14" without timezone drift.
function formatBirthday(dob: string): string | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dob)
    if (!m) return null
    const month = Number(m[2])
    const day = Number(m[3])
    if (month < 1 || month > 12) return null
    return `${MONTHS[month - 1]} ${day}`
}

export default function EmployeeCard({ employee, locationName, live, onClick }: Props) {
    const picUrl = getProfilePicSrc(employee.profile_picture_url)
    const name = employee.display_name || employee.full_name || 'Unnamed'
    const initial = name[0]?.toUpperCase() || '?'
    const [hovered, setHovered] = useState(false)
    const wrapperRef = useRef<HTMLDivElement>(null)

    const isClockedIn = !!live?.openClockIn
    const startDate = employee.created_at
        ? new Date(employee.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
        : '—'

    return (
        <div
            ref={wrapperRef}
            className="relative inline-block"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            <button
                type="button"
                onClick={onClick}
                className={`flex flex-col items-center gap-1 group focus:outline-none transition-opacity ${
                    employee.is_active ? '' : 'opacity-45 grayscale hover:opacity-80 hover:grayscale-0'
                }`}
                aria-label={`${name} — click for details`}
                title={employee.is_active ? undefined : 'Inactive employee'}
            >
                <div className="relative">
                    {picUrl ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                            src={picUrl}
                            alt={name}
                            className="w-14 h-14 rounded-full object-cover border-2 border-white dark:border-gray-700 shadow ring-2 ring-transparent group-hover:ring-primary transition-all"
                            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                        />
                    ) : (
                        <div className="w-14 h-14 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-bold text-lg border-2 border-white dark:border-gray-700 shadow ring-2 ring-transparent group-hover:ring-primary transition-all">
                            {initial}
                        </div>
                    )}
                    {/* Status dot */}
                    <span
                        className={`absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2 border-card ${
                            isClockedIn
                                ? 'bg-green-500 animate-pulse'
                                : employee.is_active
                                    ? 'bg-gray-300 dark:bg-gray-600'
                                    : 'bg-red-400'
                        }`}
                        title={isClockedIn ? 'Clocked in' : employee.is_active ? 'Active' : 'Inactive'}
                    />
                </div>
                <p className="text-xs font-medium text-center max-w-[88px] line-clamp-2 leading-tight">{name}</p>
            </button>

            {hovered && (
                <div
                    role="tooltip"
                    className="absolute left-1/2 -translate-x-1/2 bottom-full mb-3 z-30 w-72 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl text-left pointer-events-none overflow-hidden"
                    style={{ boxShadow: '0 20px 50px -10px rgba(15, 23, 42, 0.25), 0 8px 16px -6px rgba(15, 23, 42, 0.15)' }}
                >
                    {/* Header band */}
                    <div className="relative px-4 pt-4 pb-3 bg-gradient-to-br from-indigo-50 via-white to-fuchsia-50 dark:from-indigo-950/40 dark:via-slate-900 dark:to-fuchsia-950/40">
                        <div className="flex items-center gap-3">
                            {picUrl ? (
                                /* eslint-disable-next-line @next/next/no-img-element */
                                <img
                                    src={picUrl}
                                    alt=""
                                    className="w-12 h-12 rounded-full object-cover ring-2 ring-white dark:ring-slate-800 shadow-md"
                                />
                            ) : (
                                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-600 flex items-center justify-center text-white font-bold text-lg ring-2 ring-white dark:ring-slate-800 shadow-md">
                                    {initial}
                                </div>
                            )}
                            <div className="min-w-0 flex-1">
                                <p className="font-bold text-sm text-slate-900 dark:text-slate-100 truncate leading-tight">{name}</p>
                                {employee.position && (
                                    <p className="text-xs text-slate-600 dark:text-slate-400 truncate mt-0.5">{employee.position}</p>
                                )}
                                <div className="mt-1">
                                    <span
                                        className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${
                                            isClockedIn
                                                ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300'
                                                : employee.is_active
                                                    ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                                                    : 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300'
                                        }`}
                                    >
                                        <span className={`w-1.5 h-1.5 rounded-full ${
                                            isClockedIn ? 'bg-green-500 animate-pulse' : employee.is_active ? 'bg-slate-400' : 'bg-red-500'
                                        }`} />
                                        {isClockedIn ? 'Clocked in' : employee.is_active ? 'Active' : 'Inactive'}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Live status */}
                    {live && (
                        <div className="px-4 py-3 space-y-2 border-t border-slate-100 dark:border-slate-800">
                            {isClockedIn && (
                                <div className="flex items-start gap-2">
                                    <span className="text-green-500 mt-0.5">⏱</span>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold">On the clock</p>
                                        <p className="text-sm font-semibold text-green-700 dark:text-green-300 mt-0.5">Since {formatClockInTime(live.openClockIn!)}</p>
                                    </div>
                                </div>
                            )}
                            <div className="flex items-start gap-2">
                                <span className="text-indigo-500 mt-0.5">📅</span>
                                <div className="flex-1 min-w-0">
                                    <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold">Today&apos;s shift</p>
                                    {live.todayShift ? (
                                        <>
                                            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                                                {formatTime(live.todayShift.start_time)} – {formatTime(live.todayShift.end_time)}
                                            </p>
                                            {live.todayShift.location && (
                                                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{live.todayShift.location}</p>
                                            )}
                                        </>
                                    ) : (
                                        <p className="text-sm text-slate-400 dark:text-slate-500 italic mt-0.5">No shift today</p>
                                    )}
                                </div>
                            </div>
                            <div className="flex items-start gap-2">
                                <span className="text-fuchsia-500 mt-0.5">⏰</span>
                                <div className="flex-1 min-w-0">
                                    <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold">This week</p>
                                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 mt-0.5">{formatHours(live.weekMinutes)}</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Static info */}
                    <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-800 space-y-1">
                        {employee.date_of_birth && formatBirthday(employee.date_of_birth) && (
                            <p className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                                <span className="text-slate-400">🎂</span>
                                <span>Birthday: {formatBirthday(employee.date_of_birth)}</span>
                            </p>
                        )}
                        {employee.manager_name && (
                            <p className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-1.5 truncate">
                                <span className="text-slate-400">👤</span>
                                <span className="truncate">Manager: {employee.manager_name}</span>
                            </p>
                        )}
                        {employee.email && (
                            <p className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-1.5 truncate">
                                <span className="text-slate-400">✉</span>
                                <span className="truncate">{employee.email}</span>
                            </p>
                        )}
                        {(employee.store_name || employee.store_address || locationName) && (
                            <p className="text-xs text-slate-600 dark:text-slate-400 flex items-start gap-1.5">
                                <span className="text-slate-400">📍</span>
                                <span>
                                    {employee.store_name || locationName}
                                    {employee.store_address ? <><br /><span className="text-slate-500">{employee.store_address}</span></> : null}
                                </span>
                            </p>
                        )}
                        {!employee.date_of_birth && (
                            <p className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                                <span className="text-slate-400">🗓️</span>
                                <span>Since {startDate}</span>
                            </p>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="px-4 py-2 bg-gradient-to-r from-indigo-500 to-fuchsia-600 text-center">
                        <p className="text-[10px] font-semibold text-white uppercase tracking-wider">Click for full details</p>
                    </div>

                    {/* Tail */}
                    <div className="absolute left-1/2 -translate-x-1/2 -bottom-1.5 w-3 h-3 rotate-45 bg-gradient-to-br from-indigo-500 to-fuchsia-600" />
                </div>
            )}
        </div>
    )
}
