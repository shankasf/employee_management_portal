'use client'

import { useScheduleHours } from '@/lib/hooks/useData'
import {
  APPROACHING_HOURS,
  OVERTIME_HOURS,
  addDays,
  countsTowardHours,
  formatHours,
  getOvertimeStatus,
  shiftHours,
  startOfWeek,
} from '@/lib/hours-utils'

/**
 * Shown in the create/edit schedule forms: the employee's scheduled hours for
 * that Mon-Sun week including this shift, flagged when approaching or over
 * overtime. `excludeScheduleId` is the shift being edited (its old times
 * shouldn't count twice).
 */
export function OvertimeHint({
  employeeId,
  date,
  startTime,
  endTime,
  excludeScheduleId,
}: {
  employeeId: string
  date: string
  startTime: string
  endTime: string
  excludeScheduleId?: string
}) {
  const weekStart = date ? startOfWeek(date) : ''
  const weekEnd = weekStart ? addDays(weekStart, 6) : ''
  const { data: schedules = [], isLoading } = useScheduleHours(weekStart, weekEnd)

  if (!employeeId || !date || !startTime || !endTime || isLoading) return null

  const otherHours = schedules
    .filter(s => s.employee_id === employeeId && s.id !== excludeScheduleId && countsTowardHours(s))
    .reduce((sum, s) => sum + shiftHours(s.start_time, s.end_time), 0)
  const total = otherHours + shiftHours(startTime, endTime)
  const status = getOvertimeStatus(total)

  const text = `With this shift: ${formatHours(total)} scheduled hours this week (Mon–Sun).`
  if (status === 'overtime') {
    return (
      <p className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800">
        <strong>Overtime:</strong> {text} That is {formatHours(total - OVERTIME_HOURS)} h over {OVERTIME_HOURS}.
      </p>
    )
  }
  if (status === 'approaching') {
    return (
      <p className="rounded-md bg-yellow-50 border border-yellow-200 px-3 py-2 text-sm text-yellow-800">
        <strong>Approaching overtime:</strong> {text} {formatHours(OVERTIME_HOURS - total)} h left before {OVERTIME_HOURS}.
      </p>
    )
  }
  return <p className="text-xs text-muted-foreground">{text} Under {APPROACHING_HOURS} h.</p>
}
