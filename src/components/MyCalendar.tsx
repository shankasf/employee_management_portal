'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { NY_TIMEZONE, getTodayNY } from '@/lib/utils'

/**
 * "My Calendar" — one place showing PlayFunia shifts, tasks and events
 * alongside whatever the user has synced from Google or Outlook.
 *
 * Times arrive as UTC ISO strings and are rendered in New York time, which is
 * the timezone the rest of the app operates in.
 */

interface Entry {
  id: string
  source: 'playfunia' | 'external'
  sourceType: string
  provider?: string
  title: string
  description?: string | null
  location?: string | null
  start: string | null
  end: string | null
  allDay: boolean
  status?: string | null
}

type ViewMode = 'month' | 'week' | 'day'

const TYPE_STYLES: Record<string, { chip: string; dot: string; label: string }> = {
  schedule: { chip: 'bg-purple-100 text-purple-900 border-purple-200', dot: 'bg-purple-500', label: 'Shift' },
  task: { chip: 'bg-blue-100 text-blue-900 border-blue-200', dot: 'bg-blue-500', label: 'Task' },
  event: { chip: 'bg-pink-100 text-pink-900 border-pink-200', dot: 'bg-pink-500', label: 'Event' },
  birthday: { chip: 'bg-amber-100 text-amber-900 border-amber-200', dot: 'bg-amber-500', label: 'Birthday' },
  external: { chip: 'bg-gray-100 text-gray-700 border-gray-200', dot: 'bg-gray-400', label: 'Personal' },
}

function styleFor(entry: Entry) {
  return TYPE_STYLES[entry.sourceType] || TYPE_STYLES.external
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

/** The YYYY-MM-DD an instant falls on, in NY time. */
function nyDateKey(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: NY_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
  return parts // en-CA already yields YYYY-MM-DD
}

function nyTimeLabel(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: NY_TIMEZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso))
}

function parseYMD(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d, 12, 0, 0)
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(d.getDate() + n)
  return r
}

function startOfWeek(d: Date): Date {
  return addDays(d, -((d.getDay() + 6) % 7)) // Monday
}

function rangeFor(view: ViewMode, cursor: Date): { start: string; end: string; days: Date[] } {
  if (view === 'day') {
    return { start: ymd(cursor), end: ymd(cursor), days: [cursor] }
  }
  if (view === 'week') {
    const first = startOfWeek(cursor)
    const days = Array.from({ length: 7 }, (_, i) => addDays(first, i))
    return { start: ymd(first), end: ymd(days[6]), days }
  }
  // Month view is padded out to whole weeks so the grid is rectangular.
  const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1, 12)
  const lastOfMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 12)
  const gridStart = startOfWeek(firstOfMonth)
  const gridEnd = addDays(startOfWeek(lastOfMonth), 6)
  const days: Date[] = []
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) days.push(d)
  return { start: ymd(gridStart), end: ymd(gridEnd), days }
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function MyCalendar({ settingsHref }: { settingsHref: string }) {
  const [view, setView] = useState<ViewMode>('month')
  const [cursor, setCursor] = useState<Date>(() => parseYMD(getTodayNY()))
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hidePersonal, setHidePersonal] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)

  const { start, end, days } = useMemo(() => rangeFor(view, cursor), [view, cursor])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/calendar/my?start=${start}&end=${end}`)
      if (!res.ok) throw new Error('failed')
      const json = await res.json()
      setEntries(json.entries || [])
    } catch {
      setError('Could not load your calendar.')
    } finally {
      setLoading(false)
    }
  }, [start, end])

  useEffect(() => {
    load()
  }, [load])

  const byDay = useMemo(() => {
    const map: Record<string, Entry[]> = {}
    for (const entry of entries) {
      if (hidePersonal && entry.source === 'external') continue
      if (!entry.start) continue
      const key = nyDateKey(entry.start)
      ;(map[key] ||= []).push(entry)
    }
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => (a.start || '').localeCompare(b.start || ''))
    }
    return map
  }, [entries, hidePersonal])

  const hasExternal = entries.some((e) => e.source === 'external')
  const today = getTodayNY()

  const step = (direction: -1 | 1) => {
    if (view === 'day') setCursor((c) => addDays(c, direction))
    else if (view === 'week') setCursor((c) => addDays(c, 7 * direction))
    else setCursor((c) => new Date(c.getFullYear(), c.getMonth() + direction, 1, 12))
  }

  const heading = useMemo(() => {
    if (view === 'day') {
      return cursor.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    }
    if (view === 'week') {
      const first = startOfWeek(cursor)
      const last = addDays(first, 6)
      return `${first.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${last.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
    }
    return cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  }, [view, cursor])

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => step(-1)}
            className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm hover:bg-gray-50"
            aria-label="Previous"
          >
            ‹
          </button>
          <button
            onClick={() => setCursor(parseYMD(today))}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
          >
            Today
          </button>
          <button
            onClick={() => step(1)}
            className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm hover:bg-gray-50"
            aria-label="Next"
          >
            ›
          </button>
          <h2 className="ml-2 text-lg font-semibold text-gray-900">{heading}</h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {hasExternal && (
            <label className="flex items-center gap-1.5 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={hidePersonal}
                onChange={(e) => setHidePersonal(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-gray-300 text-purple-600"
              />
              Hide personal events
            </label>
          )}
          <div className="flex overflow-hidden rounded-lg border border-gray-300">
            {(['day', 'week', 'month'] as ViewMode[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 text-sm capitalize ${
                  view === v ? 'bg-purple-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
        {Object.entries(TYPE_STYLES).map(([key, s]) => (
          <span key={key} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${s.dot}`} />
            {s.label}
          </span>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {!loading && !hasExternal && (
        <div className="rounded-lg border border-purple-200 bg-purple-50 px-4 py-3 text-sm text-purple-900">
          Connect Google, Outlook or Apple Calendar in{' '}
          <Link href={settingsHref} className="font-semibold underline">
            Settings
          </Link>{' '}
          to see your personal events here too.
        </div>
      )}

      {/* Grid */}
      {view === 'month' ? (
        <div className="overflow-x-auto">
          <div className="min-w-[720px] overflow-hidden rounded-xl border border-gray-200 bg-white">
            <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50">
              {WEEKDAYS.map((d) => (
                <div key={d} className="px-2 py-2 text-center text-xs font-semibold text-gray-600">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {days.map((day) => {
                const key = ymd(day)
                const dayEntries = byDay[key] || []
                const inMonth = day.getMonth() === cursor.getMonth()
                return (
                  <div
                    key={key}
                    className={`min-h-[104px] border-b border-r border-gray-100 p-1.5 ${
                      inMonth ? 'bg-white' : 'bg-gray-50/60'
                    }`}
                  >
                    <div
                      className={`mb-1 text-xs font-semibold ${
                        key === today
                          ? 'inline-flex h-5 w-5 items-center justify-center rounded-full bg-purple-600 text-white'
                          : inMonth
                            ? 'text-gray-700'
                            : 'text-gray-400'
                      }`}
                    >
                      {day.getDate()}
                    </div>
                    <div className="space-y-1">
                      {dayEntries.slice(0, 3).map((entry) => (
                        <EntryChip key={entry.id} entry={entry} onClick={() => setSelected(entry.id)} compact />
                      ))}
                      {dayEntries.length > 3 && (
                        <button
                          onClick={() => {
                            setCursor(day)
                            setView('day')
                          }}
                          className="w-full text-left text-[11px] font-medium text-purple-700 hover:underline"
                        >
                          +{dayEntries.length - 3} more
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {days.map((day) => {
            const key = ymd(day)
            const dayEntries = byDay[key] || []
            return (
              <div key={key} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                <div
                  className={`flex items-center justify-between px-4 py-2 ${
                    key === today ? 'bg-purple-50' : 'bg-gray-50'
                  }`}
                >
                  <span className="text-sm font-semibold text-gray-900">
                    {day.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                  </span>
                  <span className="text-xs text-gray-500">
                    {dayEntries.length} {dayEntries.length === 1 ? 'item' : 'items'}
                  </span>
                </div>
                <div className="divide-y divide-gray-100">
                  {dayEntries.length === 0 ? (
                    <p className="px-4 py-4 text-sm text-gray-400">Nothing scheduled.</p>
                  ) : (
                    dayEntries.map((entry) => (
                      <EntryRow key={entry.id} entry={entry} />
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {loading && <p className="text-sm text-gray-500">Loading…</p>}

      {selected && (
        <EntryDetail
          entry={entries.find((e) => e.id === selected) || null}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

function EntryChip({ entry, onClick, compact }: { entry: Entry; onClick: () => void; compact?: boolean }) {
  const s = styleFor(entry)
  return (
    <button
      onClick={onClick}
      className={`block w-full truncate rounded border px-1.5 py-0.5 text-left text-[11px] ${s.chip}`}
      title={entry.title}
    >
      {!entry.allDay && entry.start && (
        <span className="font-semibold">{nyTimeLabel(entry.start)} </span>
      )}
      {compact ? entry.title : entry.title}
    </button>
  )
}

function EntryRow({ entry }: { entry: Entry }) {
  const s = styleFor(entry)
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${s.dot}`} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-gray-900">{entry.title}</span>
          <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${s.chip}`}>
            {s.label}
          </span>
        </div>
        <div className="mt-0.5 text-xs text-gray-500">
          {entry.allDay
            ? 'All day'
            : entry.start
              ? `${nyTimeLabel(entry.start)}${entry.end ? ` – ${nyTimeLabel(entry.end)}` : ''}`
              : ''}
          {entry.location ? ` · ${entry.location}` : ''}
        </div>
        {entry.description && (
          <p className="mt-1 whitespace-pre-wrap text-xs text-gray-500">{entry.description}</p>
        )}
      </div>
    </div>
  )
}

function EntryDetail({ entry, onClose }: { entry: Entry | null; onClose: () => void }) {
  if (!entry) return null
  const s = styleFor(entry)
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-start justify-between gap-3">
          <h3 className="text-lg font-semibold text-gray-900">{entry.title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            ✕
          </button>
        </div>
        <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${s.chip}`}>
          {s.label}
        </span>
        <dl className="mt-3 space-y-2 text-sm">
          <div>
            <dt className="text-xs text-gray-500">When</dt>
            <dd className="text-gray-900">
              {entry.allDay
                ? 'All day'
                : entry.start
                  ? `${nyTimeLabel(entry.start)}${entry.end ? ` – ${nyTimeLabel(entry.end)}` : ''}`
                  : 'Unknown'}
            </dd>
          </div>
          {entry.location && (
            <div>
              <dt className="text-xs text-gray-500">Where</dt>
              <dd className="text-gray-900">{entry.location}</dd>
            </div>
          )}
          {entry.description && (
            <div>
              <dt className="text-xs text-gray-500">Details</dt>
              <dd className="whitespace-pre-wrap text-gray-700">{entry.description}</dd>
            </div>
          )}
        </dl>
        {entry.source === 'playfunia' && entry.sourceType !== 'birthday' && (
          <a
            href={`/api/calendar/download?type=${entry.sourceType}&id=${entry.id.split(':')[1]}`}
            className="mt-4 inline-block text-sm font-medium text-purple-700 hover:underline"
          >
            Download .ics
          </a>
        )}
      </div>
    </div>
  )
}
