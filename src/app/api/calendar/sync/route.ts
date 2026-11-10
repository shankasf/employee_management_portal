import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ensureWatch, getConnections, syncUser } from '@/lib/calendar/sync'
import { calLog } from '@/lib/calendar/log'

/** Manual "Sync now" from the Settings page. */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    calLog.info('api', 'Manual "Sync now" requested', { userId: user.id })

    const results = await syncUser(user.id)

    // Opportunistically repair a push channel that lapsed.
    for (const conn of await getConnections(user.id)) {
      if (conn.status !== 'active') continue
      await ensureWatch(conn).catch((err) => {
        calLog.warn('api', 'Opportunistic watch repair failed during manual sync', {
          userId: user.id, connectionId: conn.id, provider: conn.provider, error: err,
        })
        return null
      })
    }

    calLog.info('api', 'Manual sync finished', {
      userId: user.id,
      outcomes: results.map((r) => `${r.provider}:${r.status}`).join(',') || 'none',
    })

    return NextResponse.json({ results })
  } catch (err) {
    calLog.error('api', 'Manual sync failed', { error: err })
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 })
  }
}
