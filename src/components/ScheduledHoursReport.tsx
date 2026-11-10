'use client'

import { useMemo, useState } from 'react'
import { useScheduleHours } from '@/lib/hooks/useData'
import { getTodayNY } from '@/lib/utils'
import {
  APPROACHING_HOURS,
  OVERTIME_HOURS,
  addDays,
  formatHours,
  monthRange,
  startOfWeek,
  summarizeHours,
  type OvertimeStatus,
} from '@/lib/hours-utils'

interface ReportEmployee {
  id: string
  display_name: string | null
  profiles: { full_name: string | null } | null
}

const STATUS_BADGE: Record<OvertimeStatus, { label: string; className: string }> = {
  overtime: { label: 'Overtime', className: 'badge border-transparent bg-red-100 text-red-800' },
  approaching: { label: 'Approaching', className: 'badge-warning' },
  ok: { label: 'OK', className: 'badge-success' },
}

const BAR_COLOR: Record<OvertimeStatus, string> = {
  overtime: 'bg-red-500',
  approaching: 'bg-yellow-500',
  ok: 'bg-green-500',
}

function shortDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d, 12).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function monthLabel(date: string): string {
  const [y, m] = date.split('-').map(Number)
  return new Date(y, m - 1, 1, 12).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

/**
 * Weekly + monthly scheduled hours per employee, with overtime flags.
 * Has its own week picker and query so it isn't limited by the page filters.
 */
export function ScheduledHoursReport({
  employees,
  visibleEmployeeIds,
}: {
  employees: ReportEmployee[]      // everyone, used for names
  visibleEmployeeIds: string[]     // listed even with 0 hours
}) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(getTodayNY()))
  const [showAll, setShowAll] = useState(false)
  const weekEnd = addDays(weekStart, 6)
  const month = monthRange(weekStart)

  // One query covering both the week and the month it starts in.
  const rangeStart = weekStart < month.start ? weekStart : month.start
  const rangeEnd = weekEnd > month.end ? weekEnd : month.end
  const { data: schedules = [], isLoading, error } = useScheduleHours(rangeStart, rangeEnd)

  const rows = useMemo(() => {
    const names = new Map(employees.map(e => [e.id, e.display_name || e.profiles?.full_name || 'Unknown']))
    // Anyone with scheduled hours is included even if hidden elsewhere (e.g. inactive).
    return summarizeHours(schedules, visibleEmployeeIds, weekStart)
      .map(r => ({ ...r, name: names.get(r.employeeId) ?? 'Unknown employee' }))
      .sort((a, b) => b.weekHours - a.weekHours || a.name.localeCompare(b.name))
  }, [schedules, employees, visibleEmployeeIds, weekStart])

  const overtimeCount = rows.filter(r => r.status === 'overtime').length
  const approachingCount = rows.filter(r => r.status === 'approaching').length
  const scheduledRows = rows.filter(r => r.weekHours > 0 || r.monthHours > 0)
  const visibleRows = showAll ? rows : scheduledRows
  const thisWeek = startOfWeek(getTodayNY())

  return (
    <div className="card p-4">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="font-semibold text-lg">Scheduled Hours &amp; Overtime</h3>
          <p className="text-sm text-muted-foreground">
            Week of {shortDate(weekStart)} – {shortDate(weekEnd)} · Month: {monthLabel(weekStart)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-secondary text-xs sm:text-sm" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Previous week">
            ‹ Prev
          </button>
          <button
            className="btn-secondary text-xs sm:text-sm"
            onClick={() => setWeekStart(thisWeek)}
            disabled={weekStart === thisWeek}
          >
            This week
          </button>
          <button className="btn-secondary text-xs sm:text-sm" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Next week">
            Next ›
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4 text-sm">
        <span className={`badge border-transparent ${overtimeCount > 0 ? 'bg-red-100 text-red-800' : 'bg-secondary text-secondary-foreground'}`}>
          {overtimeCount} in overtime
        </span>
        <span className={approachingCount > 0 ? 'badge-warning' : 'badge-secondary'}>
          {approachingCount} approaching
        </span>
        <span className="text-xs text-muted-foreground">
          Overtime = over {OVERTIME_HOURS} scheduled hours Mon–Sun · approaching = {APPROACHING_HOURS}–{OVERTIME_HOURS} hrs · cancelled shifts not counted · hours are before breaks
        </span>
      </div>

      {error ? (
        <p className="text-sm text-red-600">Could not load hours. Use Refresh below to try again.</p>
      ) : isLoading && schedules.length === 0 ? (
        <p className="text-sm text-muted-foreground">Loading hours…</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-2 sm:px-3 font-medium">Employee</th>
                  <th className="text-left py-2 px-2 sm:px-3 font-medium sm:min-w-[180px]">This week</th>
                  <th className="hidden sm:table-cell text-right py-2 px-3 font-medium">Shifts</th>
                  <th className="text-right py-2 px-2 sm:px-3 font-medium whitespace-nowrap">{monthLabel(weekStart).split(' ')[0].slice(0, 3)} total</th>
                  <th className="text-right py-2 px-2 sm:px-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map(r => {
                  const badge = STATUS_BADGE[r.status]
                  const pct = Math.min(100, (r.weekHours / OVERTIME_HOURS) * 100)
                  return (
                    <tr key={r.employeeId} className="border-b border-muted/50 hover:bg-muted/20">
                      <td className="py-2 px-2 sm:px-3 font-medium">{r.name}</td>
                      <td className="py-2 px-2 sm:px-3">
                        <div className="flex items-center gap-3">
                          <span className={`sm:w-14 whitespace-nowrap tabular-nums font-semibold ${r.status === 'overtime' ? 'text-red-600' : r.status === 'approaching' ? 'text-yellow-700' : ''}`}>
                            {formatHours(r.weekHours)} h
                          </span>
                          <div className="hidden sm:block flex-1 h-2 rounded-full bg-muted overflow-hidden" aria-hidden="true">
                            <div className={`h-full ${BAR_COLOR[r.status]}`} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      </td>
                      <td className="hidden sm:table-cell py-2 px-3 text-right tabular-nums">{r.weekShifts}</td>
                      <td className="py-2 px-2 sm:px-3 text-right tabular-nums whitespace-nowrap">{formatHours(r.monthHours)} h</td>
                      <td className="py-2 px-2 sm:px-3 text-right">
                        <span className={badge.className}>
                          {r.status === 'overtime' ? `OT +${formatHours(r.overtimeHours)} h` : badge.label}
                        </span>
                      </td>
                    </tr>
                  )
                })}
                {visibleRows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-4 px-3 text-center text-muted-foreground">
                      No shifts scheduled this week or month.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {rows.length > scheduledRows.length && (
            <button className="mt-3 text-xs text-primary hover:underline" onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Hide employees with no hours' : `Show all employees (${rows.length - scheduledRows.length} with no hours)`}
            </button>
          )}
        </>
      )}
    </div>
  )
}
