/**
 * Scheduled-hours math for the overtime report on the Schedules page.
 *
 * Hours are scheduled time (end - start), before any breaks - schedules carry
 * no break data. Weeks run Monday-Sunday to match the schedule calendar.
 * Overtime is weekly only (over 40h in a week); the monthly total is shown for
 * reference and is never flagged.
 */

export const OVERTIME_HOURS = 40
export const APPROACHING_HOURS = 35

export type OvertimeStatus = 'ok' | 'approaching' | 'overtime'

export interface HoursSchedule {
  id?: string
  employee_id: string
  schedule_date: string // YYYY-MM-DD
  start_time: string    // HH:MM[:SS]
  end_time: string
  status: string
}

export interface EmployeeHours {
  employeeId: string
  weekHours: number
  weekShifts: number
  monthHours: number
  status: OvertimeStatus
  overtimeHours: number // hours past OVERTIME_HOURS this week
}

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** Length of a shift in hours. An end time before the start is an overnight shift. */
export function shiftHours(start: string, end: string): number {
  let minutes = toMinutes(end) - toMinutes(start)
  if (minutes < 0) minutes += 24 * 60
  return minutes / 60
}

// Date strings are handled as local calendar dates at noon so DST never shifts a day.
function parseDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d, 12)
}

function formatDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function addDays(date: string, days: number): string {
  const d = parseDate(date)
  d.setDate(d.getDate() + days)
  return formatDate(d)
}

/** Monday of the week containing `date`. */
export function startOfWeek(date: string): string {
  const dow = parseDate(date).getDay() // 0=Sun..6=Sat
  return addDays(date, dow === 0 ? -6 : 1 - dow)
}

/** First and last day of the calendar month containing `date`. */
export function monthRange(date: string): { start: string; end: string } {
  const d = parseDate(date)
  return {
    start: formatDate(new Date(d.getFullYear(), d.getMonth(), 1, 12)),
    end: formatDate(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12)),
  }
}

export function getOvertimeStatus(weekHours: number): OvertimeStatus {
  if (weekHours > OVERTIME_HOURS) return 'overtime'
  if (weekHours >= APPROACHING_HOURS) return 'approaching'
  return 'ok'
}

/** Cancelled shifts are off the schedule; every other status still counts. */
export function countsTowardHours(schedule: Pick<HoursSchedule, 'status'>): boolean {
  return schedule.status !== 'cancelled'
}

/**
 * Per-employee hours for the week starting `weekStart` (a Monday) and for the
 * calendar month containing that Monday. `schedules` must cover both ranges.
 */
export function summarizeHours(
  schedules: HoursSchedule[],
  employeeIds: string[],
  weekStart: string,
): EmployeeHours[] {
  const weekEnd = addDays(weekStart, 6)
  const month = monthRange(weekStart)
  const totals = new Map<string, { week: number; shifts: number; month: number }>()
  for (const id of employeeIds) totals.set(id, { week: 0, shifts: 0, month: 0 })

  for (const s of schedules) {
    if (!countsTowardHours(s)) continue
    const hours = shiftHours(s.start_time, s.end_time)
    const inWeek = s.schedule_date >= weekStart && s.schedule_date <= weekEnd
    const inMonth = s.schedule_date >= month.start && s.schedule_date <= month.end
    if (!inWeek && !inMonth) continue
    let t = totals.get(s.employee_id)
    if (!t) {
      t = { week: 0, shifts: 0, month: 0 }
      totals.set(s.employee_id, t)
    }
    if (inWeek) {
      t.week += hours
      t.shifts += 1
    }
    if (inMonth) t.month += hours
  }

  return Array.from(totals.entries()).map(([employeeId, t]) => ({
    employeeId,
    weekHours: t.week,
    weekShifts: t.shifts,
    monthHours: t.month,
    status: getOvertimeStatus(t.week),
    overtimeHours: Math.max(0, t.week - OVERTIME_HOURS),
  }))
}

/** 37.5 -> "37.5", 40 -> "40" */
export function formatHours(hours: number): string {
  return String(Math.round(hours * 100) / 100)
}
