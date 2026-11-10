'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { formatTimeString, getTodayNY } from '@/lib/utils'
import {
  getEmployeeColor,
  buildEmployeeColorMap,
  exportScheduleCSV,
  exportSchedulePDF,
  exportSchedulePNG,
  type EmployeeColor,
  type ScheduleExportEntry,
} from '@/lib/schedule-utils'

export interface CalendarEntry {
  id: string
  employeeId: string
  employeeName: string
  date: string        // YYYY-MM-DD
  startTime: string    // HH:MM[:SS]
  endTime: string
  location: string | null
  status?: string
}

export type CalendarViewMode = 'day' | 'week' | 'month'

interface ScheduleCalendarProps {
  entries: CalendarEntry[]
  title?: string
  initialView?: CalendarViewMode
  /** Called whenever the visible date range changes, so the parent can fetch data. */
  onRangeChange?: (startDate: string, endDate: string) => void
  /** Hide cancelled shifts. Default true. */
  hideCancelled?: boolean
  /**
   * Ordered list of all employee ids that may appear, used to assign distinct,
   * stable colors. When omitted, colors fall back to a hash (may collide).
   */
  colorKeys?: string[]
  /** When set/changed to a YYYY-MM-DD value, moves the calendar to that date. */
  gotoDate?: string
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
// Parse YYYY-MM-DD as local noon to avoid timezone boundary drift.
function parseYMD(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d, 12, 0, 0)
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(d.getDate() + n)
  return r
}
// Monday of the week containing d.
function startOfWeek(d: Date): Date {
  const dow = d.getDay() // 0=Sun..6=Sat
  return addDays(d, -((dow + 6) % 7))
}

export function ScheduleCalendar({
  entries,
  title = 'Schedule',
  initialView = 'week',
  onRangeChange,
  hideCancelled = true,
  colorKeys,
  gotoDate,
}: ScheduleCalendarProps) {
  const [view, setView] = useState<CalendarViewMode>(initialView)
  const [cursor, setCursor] = useState<Date>(() => parseYMD(getTodayNY()))
  const [exportOpen, setExportOpen] = useState(false)
  const gridRef = useRef<HTMLDivElement>(null)
  const exportMenuRef = useRef<HTMLDivElement>(null)

  // Close the export menu on outside click.
  useEffect(() => {
    if (!exportOpen) return
    function onDoc(e: MouseEvent) {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) setExportOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [exportOpen])

  // Jump the calendar when the parent supplies a target date.
  useEffect(() => {
    if (gotoDate && /^\d{4}-\d{2}-\d{2}$/.test(gotoDate)) {
      setCursor(parseYMD(gotoDate))
    }
  }, [gotoDate])

  // Prefer a stable, collision-free color map built from the full id set;
  // fall back to a per-id hash when no key set is supplied.
  const colorMap = useMemo(
    () => (colorKeys && colorKeys.length ? buildEmployeeColorMap(colorKeys) : null),
    [colorKeys]
  )
  const colorFor = useMemo(
    () => (id: string): EmployeeColor => colorMap?.[id] ?? getEmployeeColor(id),
    [colorMap]
  )

  // The list of day-columns/cells shown for the current view.
  const days = useMemo(() => {
    if (view === 'day') return [new Date(cursor)]
    if (view === 'week') {
      const start = startOfWeek(cursor)
      return Array.from({ length: 7 }, (_, i) => addDays(start, i))
    }
    // month: 6 weeks starting from the Monday on/before the 1st
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1, 12, 0, 0)
    const gridStart = startOfWeek(first)
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
  }, [view, cursor])

  const rangeStart = ymd(days[0])
  const rangeEnd = ymd(days[days.length - 1])

  // Notify parent of the visible range so it can fetch matching data.
  useEffect(() => {
    onRangeChange?.(rangeStart, rangeEnd)
  }, [rangeStart, rangeEnd, onRangeChange])

  const visibleEntries = useMemo(() => {
    return entries.filter(e => {
      if (e.date < rangeStart || e.date > rangeEnd) return false
      if (hideCancelled && e.status === 'cancelled') return false
      return true
    })
  }, [entries, rangeStart, rangeEnd, hideCancelled])

  const entriesByDate = useMemo(() => {
    const map: Record<string, CalendarEntry[]> = {}
    for (const e of visibleEntries) {
      ;(map[e.date] ||= []).push(e)
    }
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => a.startTime.localeCompare(b.startTime) || a.employeeName.localeCompare(b.employeeName))
    }
    return map
  }, [visibleEntries])

  const legend = useMemo(() => {
    const seen = new Map<string, string>()
    for (const e of visibleEntries) if (!seen.has(e.employeeId)) seen.set(e.employeeId, e.employeeName)
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [visibleEntries])

  const todayStr = getTodayNY()

  // ---- Navigation ----
  function go(delta: number) {
    if (view === 'day') setCursor(c => addDays(c, delta))
    else if (view === 'week') setCursor(c => addDays(c, delta * 7))
    else setCursor(c => new Date(c.getFullYear(), c.getMonth() + delta, 1, 12, 0, 0))
  }
  function goToday() {
    setCursor(parseYMD(getTodayNY()))
  }

  const periodLabel = useMemo(() => {
    if (view === 'day') {
      return cursor.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    }
    if (view === 'week') {
      // Always show the month on both ends so e.g. "Jun 8 – Jun 14, 2026"
      // reads clearly (never "Jun 8 – 14, 2026").
      const s = days[0], e = days[6]
      const sFmt = s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      const eFmt = e.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      return `${sFmt} – ${eFmt}`
    }
    return cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  }, [view, cursor, days])

  // ---- Export ----
  function buildExportEntries(): ScheduleExportEntry[] {
    return visibleEntries
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
      .map(e => ({
        employeeName: e.employeeName,
        employeeKey: e.employeeId,
        location: e.location,
        date: e.date,
        dayOfWeek: parseYMD(e.date).toLocaleDateString('en-US', { weekday: 'long' }),
        startTime: e.startTime,
        endTime: e.endTime,
        status: e.status,
      }))
  }
  // e.g. "Weekly Schedule — Jun 8 – Jun 14, 2026"
  const viewLabel = view === 'day' ? 'Daily' : view === 'week' ? 'Weekly' : 'Monthly'
  const exportTitle = `${viewLabel} ${title} — ${periodLabel}`
  const fileStub = `schedule_${rangeStart}_to_${rangeEnd}`
  function handleCSV() {
    const ex = buildExportEntries()
    if (!ex.length) { alert('No shifts to export for this period.'); return }
    exportScheduleCSV(ex, `${fileStub}.csv`)
  }
  function handlePDF() {
    const ex = buildExportEntries()
    if (!ex.length) { alert('No shifts to export for this period.'); return }
    exportSchedulePDF(ex, exportTitle, colorFor)
  }
  async function handlePNG() {
    if (!gridRef.current) return
    if (!visibleEntries.length) { alert('No shifts to export for this period.'); return }
    try {
      await exportSchedulePNG(gridRef.current, `${fileStub}.png`)
    } catch (err) {
      console.error('PNG export failed:', err)
      alert('Could not export image. Please try the PDF option instead.')
    }
  }

  function openDay(date: Date) {
    setCursor(new Date(date))
    setView('day')
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button className="btn-secondary btn-sm" onClick={() => go(-1)} aria-label="Previous">‹</button>
          <button className="btn-secondary btn-sm" onClick={goToday}>Today</button>
          <button className="btn-secondary btn-sm" onClick={() => go(1)} aria-label="Next">›</button>
          <span className="ml-2 font-semibold text-sm sm:text-lg">{periodLabel}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-lg border overflow-hidden">
            {(['day', 'week', 'month'] as CalendarViewMode[]).map(v => (
              <button
                key={v}
                className={`px-3 py-1.5 text-xs sm:text-sm capitalize ${view === v ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-muted'}`}
                onClick={() => setView(v)}
              >
                {v}
              </button>
            ))}
          </div>
          <div className="relative" ref={exportMenuRef}>
            <button
              className="btn-primary btn-sm flex items-center gap-1"
              onClick={() => setExportOpen(o => !o)}
              aria-haspopup="menu"
              aria-expanded={exportOpen}
            >
              Export
              <span className="text-[10px]">▾</span>
            </button>
            {exportOpen && (
              <div className="absolute right-0 mt-1 w-44 bg-card border rounded-lg shadow-lg z-30 py-1" role="menu">
                <button
                  className="w-full text-left px-3 py-2 text-sm hover:bg-muted"
                  onClick={() => { setExportOpen(false); handlePNG() }}
                  role="menuitem"
                >
                  🖼️ Image (PNG)
                </button>
                <button
                  className="w-full text-left px-3 py-2 text-sm hover:bg-muted"
                  onClick={() => { setExportOpen(false); handlePDF() }}
                  role="menuitem"
                >
                  📄 PDF
                </button>
                <button
                  className="w-full text-left px-3 py-2 text-sm hover:bg-muted"
                  onClick={() => { setExportOpen(false); handleCSV() }}
                  role="menuitem"
                >
                  📊 CSV (Spreadsheet)
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Scroll wrapper (on-screen only) holds the export node, which shrinks
          to fit its full content width so the exported image isn't clipped. */}
      <div className="overflow-x-auto">
        <div ref={gridRef} className="inline-block align-top min-w-full bg-white rounded-lg p-4 space-y-3">
          {/* Title + meta — shown in the exported image for context */}
          <div>
            <div className="font-bold text-gray-800 text-base">{exportTitle}</div>
            <div className="text-xs text-gray-500">
              {visibleEntries.length} shift{visibleEntries.length === 1 ? '' : 's'}
            </div>
          </div>

          {/* Legend */}
          {legend.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {legend.map(emp => {
                const c = colorFor(emp.id)
                return (
                  <span
                    key={emp.id}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium"
                    style={{ backgroundColor: c.bg, color: c.text, border: `1px solid ${c.border}` }}
                  >
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.border }} />
                    {emp.name}
                  </span>
                )
              })}
            </div>
          )}

          {/* Calendar grid */}
          {view === 'month' ? (
            <MonthGrid days={days} entriesByDate={entriesByDate} todayStr={todayStr} cursorMonth={cursor.getMonth()} onOpenDay={openDay} getColor={colorFor} />
          ) : view === 'week' ? (
            <WeekGrid days={days} entriesByDate={entriesByDate} todayStr={todayStr} getColor={colorFor} />
          ) : (
            <DayAgenda date={days[0]} entries={entriesByDate[ymd(days[0])] || []} todayStr={todayStr} getColor={colorFor} />
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {visibleEntries.length} shift{visibleEntries.length === 1 ? '' : 's'} shown.
      </p>
    </div>
  )
}

// ---------------- Sub-views ----------------

function ShiftChip({ entry, getColor, compact = false }: { entry: CalendarEntry; getColor: (id: string) => EmployeeColor; compact?: boolean }) {
  const c = getColor(entry.employeeId)
  return (
    <div
      className={`rounded-md ${compact ? 'px-1.5 py-1' : 'px-2 py-1.5'} text-xs leading-tight`}
      style={{ backgroundColor: c.bg, color: c.text, borderLeft: `4px solid ${c.border}` }}
      title={`${entry.employeeName} • ${formatTimeString(entry.startTime)}–${formatTimeString(entry.endTime)}${entry.location ? ' • ' + entry.location : ''}`}
    >
      <div className={`font-semibold ${compact ? 'truncate' : 'break-words'}`}>{entry.employeeName}</div>
      <div className="font-medium">{formatTimeString(entry.startTime)} – {formatTimeString(entry.endTime)}</div>
      {!compact && entry.location && <div className="opacity-80 break-words">{entry.location}</div>}
    </div>
  )
}

function WeekGrid({ days, entriesByDate, todayStr, getColor }: {
  days: Date[]
  entriesByDate: Record<string, CalendarEntry[]>
  todayStr: string
  getColor: (id: string) => EmployeeColor
}) {
  return (
    <div className="min-w-[1120px] grid grid-cols-7 gap-2">
      {days.map(day => {
        const ds = ymd(day)
        const dayEntries = entriesByDate[ds] || []
        const isToday = ds === todayStr
        return (
          <div key={ds} className="flex flex-col">
            <div className={`text-center rounded-t-md px-2 py-1.5 ${isToday ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}>
              <div className="text-xs font-semibold uppercase tracking-wide">
                {day.toLocaleDateString('en-US', { weekday: 'short' })}
              </div>
              <div className="text-sm font-bold">{day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
            </div>
            <div className="flex-1 min-h-[90px] bg-gray-50 rounded-b-md p-1.5 space-y-1.5 border border-gray-100">
              {dayEntries.length === 0
                ? <div className="text-[11px] text-gray-300 text-center pt-3">—</div>
                : dayEntries.map(e => <ShiftChip key={e.id} entry={e} getColor={getColor} />)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function MonthGrid({ days, entriesByDate, todayStr, cursorMonth, onOpenDay, getColor }: {
  days: Date[]
  entriesByDate: Record<string, CalendarEntry[]>
  todayStr: string
  cursorMonth: number
  onOpenDay: (d: Date) => void
  getColor: (id: string) => EmployeeColor
}) {
  const MAX_CHIPS = 3
  return (
    <div className="min-w-[900px]">
      <div className="grid grid-cols-7 gap-px mb-px">
        {WEEKDAY_LABELS.map(l => (
          <div key={l} className="text-center text-xs font-semibold uppercase text-gray-500 py-1">{l}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px bg-gray-200">
        {days.map(day => {
          const ds = ymd(day)
          const dayEntries = entriesByDate[ds] || []
          const isToday = ds === todayStr
          const inMonth = day.getMonth() === cursorMonth
          return (
            <div
              key={ds}
              className={`min-h-[110px] p-1 ${inMonth ? 'bg-white' : 'bg-gray-50'} flex flex-col`}
            >
              <button
                onClick={() => onOpenDay(day)}
                className={`self-start text-xs font-semibold mb-1 rounded-full w-6 h-6 flex items-center justify-center hover:bg-blue-100 ${
                  isToday ? 'bg-blue-600 text-white' : inMonth ? 'text-gray-700' : 'text-gray-400'
                }`}
              >
                {day.getDate()}
              </button>
              <div className="space-y-1 flex-1">
                {dayEntries.slice(0, MAX_CHIPS).map(e => <ShiftChip key={e.id} entry={e} getColor={getColor} compact />)}
                {dayEntries.length > MAX_CHIPS && (
                  <button
                    onClick={() => onOpenDay(day)}
                    className="text-[11px] text-blue-600 font-medium hover:underline pl-1"
                  >
                    +{dayEntries.length - MAX_CHIPS} more
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DayAgenda({ date, entries, todayStr, getColor }: {
  date: Date
  entries: CalendarEntry[]
  todayStr: string
  getColor: (id: string) => EmployeeColor
}) {
  const ds = ymd(date)
  const isToday = ds === todayStr
  return (
    <div className="max-w-2xl mx-auto">
      <div className={`rounded-t-md px-4 py-2 ${isToday ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}>
        <div className="font-bold">{date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
      </div>
      <div className="border border-gray-100 rounded-b-md p-3 space-y-2 min-h-[120px]">
        {entries.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">No shifts scheduled.</p>
        ) : (
          entries.map(e => {
            const c = getColor(e.employeeId)
            return (
              <div
                key={e.id}
                className="flex items-center gap-3 rounded-md px-3 py-2"
                style={{ backgroundColor: c.bg, color: c.text, borderLeft: `4px solid ${c.border}` }}
              >
                <div className="font-bold text-sm w-32 shrink-0">{formatTimeString(e.startTime)} – {formatTimeString(e.endTime)}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold break-words">{e.employeeName}</div>
                  {e.location && <div className="text-xs opacity-80 break-words">{e.location}</div>}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
