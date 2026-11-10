import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildIcs } from '@/lib/calendar/ics'
import {
  defaultSyncWindow,
  getEventItems,
  getScheduleItems,
  getTaskItems,
} from '@/lib/calendar/sources'
import { getPrefs } from '@/lib/calendar/sync'
import type { PlayfuniaItem } from '@/lib/calendar/types'
import { calLog } from '@/lib/calendar/log'

/**
 * One-time .ics download — the "add to my calendar" button on a single shift,
 * task or event, plus an "export everything" mode. A snapshot, not a sync.
 */

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const type = request.nextUrl.searchParams.get('type')
  const id = request.nextUrl.searchParams.get('id')

  try {
    const prefs = await getPrefs(user.id)
    const window = defaultSyncWindow()
    let items: PlayfuniaItem[] = []
    let filename = 'playfunia.ics'

    if (!type || type === 'all') {
      const [shifts, tasks, events] = await Promise.all([
        getScheduleItems(user.id, window),
        getTaskItems(user.id, window),
        getEventItems(user.id, window),
      ])
      items = [...shifts, ...tasks, ...events]
    } else {
      if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

      // Always scoped to the signed-in user, so one employee cannot export
      // another's shift by guessing an id.
      const source =
        type === 'schedule'
          ? await getScheduleItems(user.id, window)
          : type === 'task'
            ? await getTaskItems(user.id, window)
            : type === 'event'
              ? await getEventItems(user.id, window)
              : null

      if (!source) return NextResponse.json({ error: 'Unsupported type' }, { status: 400 })

      const match = source.find((i) => i.sourceId === id)
      if (!match) return NextResponse.json({ error: 'Not found' }, { status: 404 })

      items = [match]
      filename = `playfunia-${type}.ics`
    }

    const ics = buildIcs(items, {
      calendarName: 'PlayFunia',
      reminderMinutes: prefs.reminder_minutes,
    })

    return new NextResponse(ics, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    calLog.error('feed', 'Failed to build .ics download', {
      userId: user.id, type: type || 'all', id: id || undefined, error: err,
    })
    return NextResponse.json({ error: 'Could not build calendar file' }, { status: 500 })
  }
}
