'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ScheduleCalendar, type CalendarEntry } from '@/components/ScheduleCalendar'
import { NY_TIMEZONE, formatDateTime, getTodayNY } from '@/lib/utils'

/**
 * Admin "Employee Calendar" — every employee's PlayFunia shifts in one view,
 * with each person's connection status and, for those who opted in, their
 * personal busy blocks so conflicts are visible before assigning a shift.
 */

interface Entry {
  id: string
  source: 'playfunia' | 'external'
  sourceType: string
  provider?: string
  userId: string
  userName?: string
  title: string
  description?: string | null
  location?: string | null
  start: string | null
  end: string | null
  allDay: boolean
  status?: string | null
  busyOnly?: boolean
}

interface ConnectionInfo {
  userId: string
  userName: string
  provider: string
  email: string | null
  status: string
  lastSyncedAt: string | null
  sharesPersonal: boolean
}

interface ApiResponse {
  entries: Entry[]
  employees: { id: string; name: string }[]
  connections: ConnectionInfo[]
}

/** Split a UTC instant into the NY date and HH:MM the calendar grid expects. */
function nyParts(iso: string): { date: string; time: string } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: NY_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(new Date(iso))
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '00'
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    // en-CA with hour12:false reports midnight as "24" — normalise it.
    time: `${String(Number(get('hour')) % 24).padStart(2, '0')}:${get('minute')}`,
  }
}

export default function EmployeeCalendarPage() {
  const [range, setRange] = useState<{ start: string; end: string }>({ start: '', end: '' })
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [employeeFilter, setEmployeeFilter] = useState('')
  const [showPersonal, setShowPersonal] = useState(true)

  const onRangeChange = useCallback((start: string, end: string) => {
    setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }))
  }, [])

  useEffect(() => {
    if (!range.start || !range.end) return
    let stale = false
    setLoading(true)
    setError(null)

    fetch(`/api/admin/calendar/employees?start=${range.start}&end=${range.end}`)
      .then((res) => {
        if (!res.ok) throw new Error('failed')
        return res.json()
      })
      .then((json: ApiResponse) => {
        if (!stale) setData(json)
      })
      .catch(() => {
        if (!stale) setError('Could not load employee calendars.')
      })
      .finally(() => {
        if (!stale) setLoading(false)
      })

    return () => {
      stale = true
    }
  }, [range.start, range.end])

  const entries = useMemo<CalendarEntry[]>(() => {
    if (!data) return []
    return data.entries
      .filter((e) => {
        if (employeeFilter && e.userId !== employeeFilter) return false
        if (!showPersonal && e.source === 'external') return false
        return Boolean(e.start)
      })
      .map((e) => {
        const startParts = nyParts(e.start as string)
        const endParts = e.end ? nyParts(e.end) : startParts
        const isPersonal = e.source === 'external'
        return {
          id: e.id,
          employeeId: e.userId,
          // The grid leads with this label, so mark personal blocks clearly.
          employeeName: isPersonal ? `${e.userName} — ${e.title}` : (e.userName ?? 'Unknown'),
          date: startParts.date,
          startTime: startParts.time,
          endTime: endParts.time,
          location: e.location ?? null,
          status: isPersonal ? 'personal' : (e.status ?? undefined),
        }
      })
  }, [data, employeeFilter, showPersonal])

  const colorKeys = useMemo(() => (data?.employees || []).map((e) => e.id), [data])

  const sharingCount = data?.connections.filter((c) => c.sharesPersonal).length ?? 0
  const connectedUserIds = new Set((data?.connections || []).map((c) => c.userId))

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Employee Calendar</h1>
        <p className="mt-1 text-sm text-gray-500">
          Everyone’s shifts in one place. Employees who have connected a calendar and opted in also
          show their personal busy times, so you can avoid double-booking them.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-3">
        <select
          value={employeeFilter}
          onChange={(e) => setEmployeeFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
        >
          <option value="">All employees</option>
          {(data?.employees || []).map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={showPersonal}
            onChange={(e) => setShowPersonal(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-purple-600"
          />
          Show personal busy times
          {sharingCount > 0 && (
            <span className="text-xs text-gray-400">({sharingCount} opted in)</span>
          )}
        </label>

        {loading && <span className="text-xs text-gray-400">Loading…</span>}
      </div>

      <ScheduleCalendar
        entries={entries}
        title="All employees"
        initialView="week"
        onRangeChange={onRangeChange}
        colorKeys={colorKeys}
        gotoDate={getTodayNY()}
      />

      {/* Connection roster */}
      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-900">Calendar connections</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            Who has linked an external calendar. Employees connect their own from their Settings
            page — you cannot connect on their behalf.
          </p>
        </div>

        {(data?.connections || []).length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-400">
            Nobody has connected a calendar yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-2 text-left">Employee</th>
                  <th className="px-4 py-2 text-left">Provider</th>
                  <th className="px-4 py-2 text-left">Account</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-left">Last synced</th>
                  <th className="px-4 py-2 text-left">Shares personal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(data?.connections || []).map((c) => (
                  <tr key={`${c.userId}:${c.provider}`}>
                    <td className="px-4 py-2 font-medium text-gray-900">{c.userName}</td>
                    <td className="px-4 py-2 capitalize text-gray-700">{c.provider}</td>
                    <td className="px-4 py-2 break-all text-gray-500">{c.email || '—'}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          c.status === 'active'
                            ? 'bg-green-100 text-green-800'
                            : c.status === 'needs_reauth'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {c.status === 'needs_reauth' ? 'reconnect needed' : c.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-500">
                      {c.lastSyncedAt ? formatDateTime(c.lastSyncedAt) : 'never'}
                    </td>
                    <td className="px-4 py-2 text-gray-500">{c.sharesPersonal ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && data.employees.length > connectedUserIds.size && (
          <p className="border-t border-gray-100 px-4 py-2 text-xs text-gray-400">
            {data.employees.length - connectedUserIds.size} employee(s) have not connected a
            calendar. Their shifts still appear above.
          </p>
        )}
      </section>
    </div>
  )
}
