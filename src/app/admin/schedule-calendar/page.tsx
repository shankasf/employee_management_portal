'use client'

import { useCallback, useMemo, useState } from 'react'
import { useEmployees, useSchedules, useLocations } from '@/lib/hooks/useData'
import { ScheduleCalendar, type CalendarEntry } from '@/components/ScheduleCalendar'
import { ScheduleStatus } from '@/types/supabase'

interface EmployeeLite {
  id: string
  display_name: string | null
  is_active: boolean
  shift_type: string | null
  profiles: { full_name: string | null } | null
}

type TimeOfDay = 'all' | 'morning' | 'midday' | 'evening'

interface ScheduleRow {
  id: string
  employee_id: string
  schedule_date: string
  start_time: string
  end_time: string
  location: string | null
  status: ScheduleStatus
  employee?: {
    display_name: string | null
    profiles?: { full_name: string | null } | null
  } | null
}

export default function ScheduleCalendarPage() {
  const { data: employees = [] } = useEmployees(true) as { data: EmployeeLite[] }
  const { data: locationData = [] } = useLocations()

  const [range, setRange] = useState<{ start: string; end: string }>({ start: '', end: '' })
  const [employeeFilter, setEmployeeFilter] = useState('')
  const [locationFilter, setLocationFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<ScheduleStatus | 'all'>('all')
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>('all')
  const [shiftTypeFilter, setShiftTypeFilter] = useState('')
  const [dayOfWeekFilter, setDayOfWeekFilter] = useState('') // '' = any, else '0'..'6' (Sun..Sat)
  const [jumpDate, setJumpDate] = useState('')

  // Fetch only the schedules within the calendar's visible range (+ employee filter).
  const filters = useMemo(() => ({
    startDate: range.start || undefined,
    endDate: range.end || undefined,
    employeeId: employeeFilter || undefined,
  }), [range.start, range.end, employeeFilter])

  const { data: schedules = [], isLoading } = useSchedules(filters)

  // Stable callback so the calendar's range effect doesn't loop.
  const onRangeChange = useCallback((start: string, end: string) => {
    setRange(prev => (prev.start === start && prev.end === end ? prev : { start, end }))
  }, [])

  // employee id -> shift_type, for the shift-type filter
  const shiftTypeById = useMemo(() => {
    const m: Record<string, string | null> = {}
    for (const e of employees) m[e.id] = e.shift_type
    return m
  }, [employees])

  // distinct shift types present, for the dropdown
  const shiftTypeOptions = useMemo(() => {
    const set = new Set<string>()
    for (const e of employees) if (e.shift_type) set.add(e.shift_type)
    return Array.from(set).sort()
  }, [employees])

  const entries = useMemo<CalendarEntry[]>(() => {
    return (schedules as ScheduleRow[])
      .filter(s => {
        if (statusFilter !== 'all' && s.status !== statusFilter) return false
        if (locationFilter && (s.location || '') !== locationFilter) return false
        // Time of day — based on the shift's start time (HH:MM)
        if (timeOfDay !== 'all') {
          const hm = (s.start_time || '').slice(0, 5)
          if (timeOfDay === 'morning' && !(hm < '12:00')) return false
          if (timeOfDay === 'midday' && !(hm >= '12:00' && hm < '17:00')) return false
          if (timeOfDay === 'evening' && !(hm >= '17:00')) return false
        }
        // Shift type — from the employee's profile
        if (shiftTypeFilter && shiftTypeById[s.employee_id] !== shiftTypeFilter) return false
        // Day of week — schedule_date's weekday (parse as local noon)
        if (dayOfWeekFilter !== '') {
          const [y, m, d] = s.schedule_date.split('-').map(Number)
          if (new Date(y, m - 1, d, 12).getDay() !== Number(dayOfWeekFilter)) return false
        }
        return true
      })
      .map(s => ({
        id: s.id,
        employeeId: s.employee_id,
        employeeName: s.employee?.display_name || s.employee?.profiles?.full_name || 'Unknown',
        date: s.schedule_date,
        startTime: s.start_time,
        endTime: s.end_time,
        location: s.location,
        status: s.status,
      }))
  }, [schedules, statusFilter, locationFilter, timeOfDay, shiftTypeFilter, dayOfWeekFilter, shiftTypeById])

  const locationOptions = useMemo(() => locationData.map(l => l.label), [locationData])
  const visibleEmployees = useMemo(
    () => employees.filter(e => e.id && e.is_active !== false),
    [employees]
  )

  const hasActiveFilters = !!(
    employeeFilter || locationFilter || statusFilter !== 'all' ||
    timeOfDay !== 'all' || shiftTypeFilter || dayOfWeekFilter !== '' || jumpDate
  )

  function clearAll() {
    setEmployeeFilter(''); setLocationFilter(''); setStatusFilter('all')
    setTimeOfDay('all'); setShiftTypeFilter(''); setDayOfWeekFilter(''); setJumpDate('')
  }

  const WEEKDAY_OPTS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Schedule Calendar</h1>
        <p className="text-muted-foreground mt-1 text-sm sm:text-base">
          Day, week, and month views of all employee shifts — color-coded by employee.
        </p>
      </div>

      {/* Filters */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Filters</h3>
          {hasActiveFilters && (
            <button className="text-xs text-blue-600 hover:underline" onClick={clearAll}>
              Clear filters
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          <div>
            <label className="label">Employee</label>
            <select className="input" value={employeeFilter} onChange={e => setEmployeeFilter(e.target.value)}>
              <option value="">All Employees</option>
              {visibleEmployees.map(emp => (
                <option key={emp.id} value={emp.id}>
                  {emp.display_name || emp.profiles?.full_name || 'Unknown'}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Location</label>
            <select className="input" value={locationFilter} onChange={e => setLocationFilter(e.target.value)}>
              <option value="">All Locations</option>
              {locationOptions.map(loc => (
                <option key={loc} value={loc}>{loc}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Status</label>
            <select className="input" value={statusFilter} onChange={e => setStatusFilter(e.target.value as ScheduleStatus | 'all')}>
              <option value="all">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="confirmed">Confirmed</option>
              <option value="cancellation_requested">Cancel Requested</option>
              <option value="cancelled">Cancelled</option>
              <option value="completed">Completed</option>
            </select>
          </div>
          <div>
            <label className="label">Shift Type</label>
            <select className="input" value={shiftTypeFilter} onChange={e => setShiftTypeFilter(e.target.value)}>
              <option value="">All Shift Types</option>
              {shiftTypeOptions.map(t => (
                <option key={t} value={t} className="capitalize">{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Time of Day</label>
            <select className="input" value={timeOfDay} onChange={e => setTimeOfDay(e.target.value as TimeOfDay)}>
              <option value="all">Any Time</option>
              <option value="morning">Morning (before 12 PM)</option>
              <option value="midday">Midday (12–5 PM)</option>
              <option value="evening">Evening (5 PM+)</option>
            </select>
          </div>
          <div>
            <label className="label">Day of Week</label>
            <select className="input" value={dayOfWeekFilter} onChange={e => setDayOfWeekFilter(e.target.value)}>
              <option value="">Any Day</option>
              {WEEKDAY_OPTS.map((d, i) => (
                <option key={d} value={String(i)}>{d}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Jump to Date</label>
            <input type="date" className="input" value={jumpDate} onChange={e => setJumpDate(e.target.value)} />
          </div>
          <div className="flex items-end">
            <button className="btn-secondary w-full" onClick={clearAll} disabled={!hasActiveFilters}>
              Clear All
            </button>
          </div>
        </div>
      </div>

      {/* Calendar */}
      <div className="card p-4">
        <ScheduleCalendar
          entries={entries}
          title="Schedule"
          onRangeChange={onRangeChange}
          hideCancelled={statusFilter === 'all'}
          colorKeys={employees.map(e => e.id)}
          gotoDate={jumpDate}
        />
        {isLoading && (
          <p className="text-xs text-muted-foreground mt-2">Loading shifts…</p>
        )}
      </div>
    </div>
  )
}
