import { NextRequest, NextResponse } from 'next/server'

import { getScopedEmployeeIds, requireAdmin } from '@/lib/auth/adminScope'
import { getNYOffsetStr, formatTimeString } from '@/lib/utils'
import type { UnifiedCalendarEntry } from '@/lib/calendar/types'
import { calendarDb } from '@/lib/calendar/db'
import { calLog } from '@/lib/calendar/log'

/**
 * Admin "Employee Calendar" — every employee's PlayFunia shifts in one place,
 * plus their personal external events for the people who opted in.
 *
 * Privacy rules, enforced here because this route uses the service role:
 *  - location-scoped admins only ever see employees in their scope
 *  - a personal event is only included when that employee turned on
 *    `share_external_with_admin`
 *  - if they did NOT also turn on `share_external_details`, the event is
 *    reduced to an anonymous "Busy" block with no title, notes or location
 */

export const dynamic = 'force-dynamic'

interface ScheduleRow {
  id: string
  employee_id: string
  schedule_date: string
  start_time: string
  end_time: string
  title: string | null
  location: string | null
  status: string
}

interface ExternalRow {
  id: string
  user_id: string
  provider: string
  title: string | null
  description: string | null
  location: string | null
  starts_at: string | null
  ends_at: string | null
  all_day: boolean
  status: string | null
}

interface ConnectionRow {
  user_id: string
  provider: string
  provider_account_email: string | null
  status: string
  last_synced_at: string | null
}

function nyToUtc(dateStr: string, timeStr: string | null): string {
  const raw = (timeStr || '00:00:00').slice(0, 8)
  const normalized = raw.length === 5 ? `${raw}:00` : raw
  return new Date(`${dateStr}T${normalized}${getNYOffsetStr(dateStr)}`).toISOString()
}

export async function GET(request: NextRequest) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.response

  const start = request.nextUrl.searchParams.get('start')
  const end = request.nextUrl.searchParams.get('end')
  if (!start || !end || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return NextResponse.json({ error: 'start and end (YYYY-MM-DD) are required' }, { status: 400 })
  }

  try {
    const service = await calendarDb()
    const scopedIds = await getScopedEmployeeIds(gate.ctx)

    // Employee directory for names (and to bound the scoped set).
    let empQuery = service
      .from('employees')
      .select('id, display_name, is_active')
      .eq('is_active', true)
    if (scopedIds) {
      if (!scopedIds.length) return NextResponse.json({ entries: [], employees: [], connections: [] })
      empQuery = empQuery.in('id', scopedIds)
    }
    const { data: empRaw } = await empQuery

    const employees = (empRaw || []) as { id: string; display_name: string | null }[]
    const employeeIds = employees.map((e) => e.id)
    const nameById = new Map(employees.map((e) => [e.id, e.display_name || 'Unnamed']))

    if (!employeeIds.length) {
      return NextResponse.json({ entries: [], employees: [], connections: [] })
    }

    // ---- PlayFunia shifts ----
    const { data: schedRaw } = await service
      .from('schedules')
      .select('id, employee_id, schedule_date, start_time, end_time, title, location, status')
      .in('employee_id', employeeIds)
      .gte('schedule_date', start)
      .lte('schedule_date', end)
      .neq('status', 'cancelled')
      .order('schedule_date')

    const entries: UnifiedCalendarEntry[] = ((schedRaw || []) as ScheduleRow[]).map((s) => ({
      id: `schedule:${s.id}`,
      source: 'playfunia',
      sourceType: 'schedule',
      userId: s.employee_id,
      userName: nameById.get(s.employee_id) || 'Unknown',
      title: s.title?.trim() || 'Shift',
      location: s.location,
      start: nyToUtc(s.schedule_date, s.start_time),
      end: nyToUtc(s.schedule_date, s.end_time),
      allDay: false,
      status: s.status,
      description: `${formatTimeString(s.start_time)} – ${formatTimeString(s.end_time)}`,
    }))

    // ---- Who opted in to sharing their personal calendar? ----
    const { data: prefsRaw } = await service
      .from('calendar_sync_prefs')
      .select('user_id, share_external_with_admin, share_external_details')
      .in('user_id', employeeIds)
      .eq('share_external_with_admin', true)

    const sharing = new Map(
      ((prefsRaw || []) as { user_id: string; share_external_details: boolean }[]).map((p) => [
        p.user_id,
        p.share_external_details,
      ]),
    )

    if (sharing.size) {
      const { data: extRaw } = await service
        .from('calendar_external_events')
        .select('id, user_id, provider, title, description, location, starts_at, ends_at, all_day, status')
        .in('user_id', Array.from(sharing.keys()))
        .eq('is_playfunia', false)
        .gte('starts_at', `${start}T00:00:00Z`)
        .lte('starts_at', `${end}T23:59:59Z`)
        .order('starts_at')

      for (const row of (extRaw || []) as ExternalRow[]) {
        if (row.status === 'cancelled') continue
        const showDetails = sharing.get(row.user_id) === true
        entries.push({
          id: `external:${row.id}`,
          source: 'external',
          sourceType: 'external',
          provider: row.provider as 'google' | 'microsoft',
          userId: row.user_id,
          userName: nameById.get(row.user_id) || 'Unknown',
          // Without detail consent this is a bare busy block by design.
          title: showDetails ? row.title || '(No title)' : 'Busy',
          description: showDetails ? row.description : null,
          location: showDetails ? row.location : null,
          start: row.starts_at,
          end: row.ends_at,
          allDay: row.all_day,
          status: row.status,
          busyOnly: !showDetails,
        })
      }
    }

    entries.sort((a, b) => (a.start || '').localeCompare(b.start || ''))

    // ---- Connection status per employee, for the roster panel ----
    const { data: connRaw } = await service
      .from('calendar_connections')
      .select('user_id, provider, provider_account_email, status, last_synced_at')
      .in('user_id', employeeIds)

    return NextResponse.json({
      entries,
      employees: employees.map((e) => ({ id: e.id, name: e.display_name || 'Unnamed' })),
      connections: ((connRaw || []) as ConnectionRow[]).map((row) => {
        return {
          userId: row.user_id,
          userName: nameById.get(row.user_id) || 'Unknown',
          provider: row.provider,
          email: row.provider_account_email,
          status: row.status,
          lastSyncedAt: row.last_synced_at,
          sharesPersonal: sharing.has(row.user_id),
        }
      }),
    })
  } catch (err) {
    calLog.error('api', 'Failed to load employee calendars', {
      userId: gate.ctx.userId, range: `${start}..${end}`, error: err,
    })
    return NextResponse.json({ error: 'Could not load employee calendars' }, { status: 500 })
  }
}
