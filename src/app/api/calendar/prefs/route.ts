import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { DEFAULT_SYNC_PREFS } from '@/lib/calendar/types'
import { getConnections, getPrefs, syncConnection } from '@/lib/calendar/sync'
import { calendarDb } from '@/lib/calendar/db'
import { calLog } from '@/lib/calendar/log'

/** Read/update the signed-in user's calendar sync preferences. */

export const dynamic = 'force-dynamic'

const BOOLEAN_FIELDS = [
  'sync_shifts',
  'sync_tasks',
  'sync_events',
  'sync_birthdays',
  'sync_onboarding',
  'share_external_with_admin',
  'share_external_details',
] as const

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  return NextResponse.json({ prefs: await getPrefs(user.id) })
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = (await request.json()) as Record<string, unknown>
    const patch: Record<string, unknown> = {}

    for (const field of BOOLEAN_FIELDS) {
      if (typeof body[field] === 'boolean') patch[field] = body[field]
    }

    if (body.reminder_minutes !== undefined) {
      const minutes = Number(body.reminder_minutes)
      if (!Number.isInteger(minutes) || minutes < 0 || minutes > 10080) {
        return NextResponse.json({ error: 'reminder_minutes must be 0–10080' }, { status: 400 })
      }
      patch.reminder_minutes = minutes
    }

    // Detail sharing is meaningless without the base opt-in; keep them coherent.
    if (patch.share_external_with_admin === false) {
      patch.share_external_details = false
    }

    if (!Object.keys(patch).length) {
      return NextResponse.json({ error: 'No valid fields supplied' }, { status: 400 })
    }

    const service = await calendarDb()
    const { error } = await service
      .from('calendar_sync_prefs')
      .upsert(
        { ...DEFAULT_SYNC_PREFS, ...(await getPrefs(user.id)), ...patch, user_id: user.id },
        { onConflict: 'user_id' },
      )

    if (error) {
      calLog.error('prefs', 'Failed to save preferences', { userId: user.id, error, data: patch })
      return NextResponse.json({ error: 'Could not save preferences' }, { status: 500 })
    }

    calLog.info('prefs', 'Preferences updated', { userId: user.id, changed: patch })

    const prefs = await getPrefs(user.id)

    // Toggling what syncs must add/remove events, so re-push in the background.
    const connections = (await getConnections(user.id)).filter((c) => c.status === 'active')
    await Promise.all(
      connections.map((conn) =>
        syncConnection(conn, prefs).catch((err) => {
          calLog.error('prefs', 'Re-sync after preference change failed', {
            userId: user.id, connectionId: conn.id, provider: conn.provider, error: err,
          })
          return null
        }),
      ),
    )

    return NextResponse.json({ prefs })
  } catch (err) {
    calLog.error('prefs', 'Unhandled error saving preferences', { error: err })
    return NextResponse.json({ error: 'Could not save preferences' }, { status: 500 })
  }
}
