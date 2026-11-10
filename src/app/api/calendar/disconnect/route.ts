import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { disconnectProvider } from '@/lib/calendar/sync'
import { calLog } from '@/lib/calendar/log'

/**
 * Disconnect a provider. By default we also delete the PlayFunia calendar we
 * created in their account, so nothing of ours is left behind.
 */

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = (await request.json().catch(() => ({}))) as {
      provider?: string
      keepCalendar?: boolean
    }

    if (body.provider !== 'google' && body.provider !== 'microsoft') {
      return NextResponse.json({ error: 'Unsupported provider' }, { status: 400 })
    }

    calLog.info('api', 'Disconnect requested', {
      userId: user.id, provider: body.provider, keepCalendar: body.keepCalendar === true,
    })

    await disconnectProvider(user.id, body.provider, body.keepCalendar !== true)

    return NextResponse.json({ ok: true })
  } catch (err) {
    calLog.error('api', 'Disconnect request failed', { error: err })
    return NextResponse.json({ error: 'Could not disconnect' }, { status: 500 })
  }
}
