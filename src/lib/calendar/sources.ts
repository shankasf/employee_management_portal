import { getNYOffsetStr, formatTimeString } from '@/lib/utils'
import type { PlayfuniaItem, CalendarSyncPrefs } from './types'
import { calendarDb } from './db'

/**
 * Collects the PlayFunia items that belong on one user's calendar.
 *
 * Everything here is read-only. The output is provider-agnostic so the same
 * list feeds the Google push, the Microsoft push, the ICS feed and the
 * in-app "My Calendar" view.
 */

/** How far back / forward we keep an external calendar populated. */
export const SYNC_WINDOW_PAST_DAYS = 30
export const SYNC_WINDOW_FUTURE_DAYS = 180

export interface SyncWindow {
  /** YYYY-MM-DD */
  startDate: string
  endDate: string
}

function shiftDate(days: number, from = new Date()): string {
  const d = new Date(from.getTime() + days * 86400000)
  return d.toISOString().slice(0, 10)
}

export function defaultSyncWindow(): SyncWindow {
  return {
    startDate: shiftDate(-SYNC_WINDOW_PAST_DAYS),
    endDate: shiftDate(SYNC_WINDOW_FUTURE_DAYS),
  }
}

/**
 * Convert a NY-local date + time into a UTC ISO string, honouring DST via the
 * offset helper already used across the app.
 */
function nyToUtc(dateStr: string, timeStr: string | null): string {
  // Postgres time columns arrive as HH:MM or HH:MM:SS; normalise to HH:MM:SS.
  const raw = (timeStr || '00:00:00').slice(0, 8)
  const normalized = raw.length === 5 ? `${raw}:00` : raw
  const offset = getNYOffsetStr(dateStr)
  return new Date(`${dateStr}T${normalized}${offset}`).toISOString()
}

/** Add one day to a YYYY-MM-DD string (all-day events use an exclusive end). */
function nextDay(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

interface ScheduleRow {
  id: string
  schedule_date: string
  start_time: string
  end_time: string
  title: string | null
  description: string | null
  location: string | null
  status: string
}

interface TaskInstanceRow {
  id: string
  scheduled_date: string
  status: string
  tasks: {
    title: string | null
    description: string | null
    location: string | null
    cutoff_time: string | null
  } | null
}

interface EventAssignmentRow {
  role: string | null
  events: {
    id: string
    title: string
    start_time: string
    end_time: string
    room: string | null
    notes: string | null
  } | null
}

/** Shifts assigned to the user. Cancelled shifts are returned so the pusher can delete them. */
export async function getScheduleItems(
  userId: string,
  window: SyncWindow,
): Promise<PlayfuniaItem[]> {
  const service = await calendarDb()
  const { data, error } = await service
    .from('schedules')
    .select('id, schedule_date, start_time, end_time, title, description, location, status')
    .eq('employee_id', userId)
    .gte('schedule_date', window.startDate)
    .lte('schedule_date', window.endDate)
    .order('schedule_date')

  if (error) throw new Error(`Failed to load schedules: ${error.message}`)

  return ((data || []) as ScheduleRow[]).map((s) => {
    const start = nyToUtc(s.schedule_date, s.start_time)
    let end = nyToUtc(s.schedule_date, s.end_time)
    // Overnight shift — the end time lands before the start time.
    if (new Date(end) <= new Date(start)) {
      end = nyToUtc(nextDay(s.schedule_date), s.end_time)
    }
    const timeLabel = `${formatTimeString(s.start_time)} – ${formatTimeString(s.end_time)}`
    return {
      sourceType: 'schedule' as const,
      sourceId: s.id,
      userId,
      title: s.title?.trim() || 'PlayFunia Shift',
      description: [s.description, `Shift ${timeLabel}`, 'Managed by PlayFunia — changes made here are sent to your manager for approval.']
        .filter(Boolean)
        .join('\n\n'),
      location: s.location,
      start,
      end,
      allDay: false,
      status: s.status,
      remind: true,
    }
  })
}

/** Task instances assigned to the user. */
export async function getTaskItems(
  userId: string,
  window: SyncWindow,
): Promise<PlayfuniaItem[]> {
  const service = await calendarDb()
  const { data, error } = await service
    .from('task_instances')
    .select('id, scheduled_date, status, tasks ( title, description, location, cutoff_time )')
    .eq('employee_id', userId)
    .gte('scheduled_date', window.startDate)
    .lte('scheduled_date', window.endDate)
    .order('scheduled_date')

  if (error) throw new Error(`Failed to load tasks: ${error.message}`)

  return ((data || []) as unknown as TaskInstanceRow[]).map((t) => {
    const task = t.tasks
    const cutoff = task?.cutoff_time
    const hasCutoff = Boolean(cutoff)
    // With a cutoff we render a 30-minute block ending at the cutoff, so it
    // reads as a deadline rather than swallowing the whole day.
    const end = hasCutoff ? nyToUtc(t.scheduled_date, cutoff as string) : null
    const start = end ? new Date(new Date(end).getTime() - 30 * 60000).toISOString() : null

    return {
      sourceType: 'task' as const,
      sourceId: t.id,
      userId,
      title: `Task: ${task?.title?.trim() || 'Untitled task'}`,
      description: [task?.description, hasCutoff ? `Due by ${formatTimeString(cutoff as string)}` : 'Due today']
        .filter(Boolean)
        .join('\n\n'),
      location: task?.location ?? null,
      start,
      end,
      startDate: hasCutoff ? undefined : t.scheduled_date,
      endDate: hasCutoff ? undefined : nextDay(t.scheduled_date),
      allDay: !hasCutoff,
      status: t.status,
      remind: true,
    }
  })
}

/** Company events the user is actually staffed on. */
export async function getEventItems(
  userId: string,
  window: SyncWindow,
): Promise<PlayfuniaItem[]> {
  const service = await calendarDb()
  const startIso = new Date(`${window.startDate}T00:00:00Z`).toISOString()
  const endIso = new Date(`${window.endDate}T23:59:59Z`).toISOString()

  const { data, error } = await service
    .from('event_staff_assignments')
    .select('role, events ( id, title, start_time, end_time, room, notes )')
    .eq('employee_id', userId)

  if (error) throw new Error(`Failed to load events: ${error.message}`)

  return ((data || []) as unknown as EventAssignmentRow[])
    .filter((row) => {
      const ev = row.events
      if (!ev?.start_time) return false
      return ev.start_time >= startIso && ev.start_time <= endIso
    })
    .map((row) => {
      const ev = row.events!
      return {
        sourceType: 'event' as const,
        sourceId: ev.id,
        userId,
        title: `Event: ${ev.title}`,
        description: [ev.notes, row.role ? `Your role: ${row.role}` : null]
          .filter(Boolean)
          .join('\n\n') || null,
        location: ev.room,
        start: new Date(ev.start_time).toISOString(),
        end: new Date(ev.end_time || ev.start_time).toISOString(),
        allDay: false,
        status: 'confirmed',
        remind: true,
      }
    })
}

interface BirthdayRow {
  id: string
  display_name: string | null
  date_of_birth: string | null
  is_active: boolean
}

/**
 * Team birthdays as all-day entries. Opt-in (default off) because it writes one
 * event per teammate per year into the user's personal calendar.
 */
export async function getBirthdayItems(
  userId: string,
  window: SyncWindow,
): Promise<PlayfuniaItem[]> {
  const service = await calendarDb()
  const { data, error } = await service
    .from('employees')
    .select('id, display_name, date_of_birth, is_active')
    .eq('is_active', true)
    .not('date_of_birth', 'is', null)

  if (error) throw new Error(`Failed to load birthdays: ${error.message}`)

  const items: PlayfuniaItem[] = []
  const startYear = Number(window.startDate.slice(0, 4))
  const endYear = Number(window.endDate.slice(0, 4))

  for (const emp of (data || []) as BirthdayRow[]) {
    const dob = emp.date_of_birth
    if (!dob) continue
    const monthDay = dob.slice(5, 10) // MM-DD
    if (monthDay === '02-29') continue // skip leap-day edge case

    for (let year = startYear; year <= endYear; year++) {
      const date = `${year}-${monthDay}`
      if (date < window.startDate || date > window.endDate) continue
      items.push({
        sourceType: 'birthday',
        sourceId: `${emp.id}:${year}`,
        userId,
        title: `🎂 ${emp.display_name || 'Teammate'}'s birthday`,
        description: null,
        location: null,
        start: null,
        end: null,
        startDate: date,
        endDate: nextDay(date),
        allDay: true,
        status: 'confirmed',
        remind: false,
      })
    }
  }

  return items
}

/**
 * All items a user's preferences say should appear on their calendar.
 * Cancelled shifts are kept in the list; the pusher turns them into deletions.
 */
export async function collectItems(
  userId: string,
  prefs: CalendarSyncPrefs,
  window: SyncWindow = defaultSyncWindow(),
): Promise<PlayfuniaItem[]> {
  const jobs: Promise<PlayfuniaItem[]>[] = []
  if (prefs.sync_shifts) jobs.push(getScheduleItems(userId, window))
  if (prefs.sync_tasks) jobs.push(getTaskItems(userId, window))
  if (prefs.sync_events) jobs.push(getEventItems(userId, window))
  if (prefs.sync_birthdays) jobs.push(getBirthdayItems(userId, window))

  const results = await Promise.all(jobs)
  return results.flat()
}
