import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { collectItems } from '@/lib/calendar/sources'
import { getPrefs } from '@/lib/calendar/sync'
import type { UnifiedCalendarEntry } from '@/lib/calendar/types'
import { calendarDb } from '@/lib/calendar/db'
import { calLog } from '@/lib/calendar/log'

/**
 * "My Calendar" — the signed-in user's PlayFunia items merged with the events
 * pulled from every calendar they have connected.
 *
 * Events we ourselves wrote into their account are filtered out, so a shift
 * appears once rather than twice.
 */

export const dynamic = 'force-dynamic'

interface ExternalRow {
  id: string
  provider: string
  external_id: string
  title: string | null
  description: string | null
  location: string | null
  starts_at: string | null
  ends_at: string | null
  all_day: boolean
  status: string | null
  is_playfunia: boolean
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const start = request.nextUrl.searchParams.get('start')
    const end = request.nextUrl.searchParams.get('end')
    if (!start || !end || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      return NextResponse.json({ error: 'start and end (YYYY-MM-DD) are required' }, { status: 400 })
    }

    const prefs = await getPrefs(user.id)

    // PlayFunia's own items always show, regardless of what is being pushed to
    // an external calendar — this view is the in-app hub.
    const items = await collectItems(
      user.id,
      { ...prefs, sync_shifts: true, sync_tasks: true, sync_events: true },
      { startDate: start, endDate: end },
    )

    const entries: UnifiedCalendarEntry[] = items
      .filter((i) => i.status !== 'cancelled')
      .map((i) => ({
        id: `${i.sourceType}:${i.sourceId}`,
        source: 'playfunia',
        sourceType: i.sourceType,
        userId: user.id,
        title: i.title,
        description: i.description,
        location: i.location,
        start: i.allDay ? `${i.startDate}T00:00:00.000Z` : i.start,
        end: i.allDay ? `${i.endDate}T00:00:00.000Z` : i.end,
        allDay: i.allDay,
        status: i.status,
      }))

    const service = await calendarDb()
    const { data: externalRaw } = await service
      .from('calendar_external_events')
      .select('id, provider, external_id, title, description, location, starts_at, ends_at, all_day, status, is_playfunia')
      .eq('user_id', user.id)
      .eq('is_playfunia', false)
      .gte('starts_at', `${start}T00:00:00Z`)
      .lte('starts_at', `${end}T23:59:59Z`)
      .order('starts_at')

    for (const row of (externalRaw || []) as ExternalRow[]) {
      if (row.status === 'cancelled') continue
      entries.push({
        id: `external:${row.id}`,
        source: 'external',
        sourceType: 'external',
        provider: row.provider as 'google' | 'microsoft',
        userId: user.id,
        title: row.title || '(No title)',
        description: row.description,
        location: row.location,
        start: row.starts_at,
        end: row.ends_at,
        allDay: row.all_day,
        status: row.status,
      })
    }

    entries.sort((a, b) => (a.start || '').localeCompare(b.start || ''))

    calLog.debug('api', 'My Calendar served', {
      userId: user.id, range: `${start}..${end}`, entries: entries.length,
    })

    return NextResponse.json({ entries })
  } catch (err) {
    calLog.error('api', 'Failed to load My Calendar', { error: err })
    return NextResponse.json({ error: 'Could not load calendar' }, { status: 500 })
  }
}
