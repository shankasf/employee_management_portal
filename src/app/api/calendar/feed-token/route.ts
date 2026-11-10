import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateSecret, hashToken } from '@/lib/calendar/crypto'
import { appBaseUrl } from '@/lib/calendar/providers/google'
import { calendarDb } from '@/lib/calendar/db'
import { calLog } from '@/lib/calendar/log'

/**
 * Manage the secret ICS subscription link.
 *
 * The raw token is returned exactly once, at creation. Only its hash is
 * stored, so a database leak does not expose everyone's shift feed.
 */

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = (await request.json().catch(() => ({}))) as { label?: string }
    const label = typeof body.label === 'string' ? body.label.slice(0, 60) : 'Calendar subscription'

    const service = await calendarDb()

    // Regenerating revokes the old link, which is the point: it is how a user
    // cuts off a lost phone.
    await service
      .from('calendar_feed_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .is('revoked_at', null)

    const token = generateSecret(32)
    const { error } = await service.from('calendar_feed_tokens').insert({
      user_id: user.id,
      token_hash: hashToken(token),
      label,
    })

    if (error) {
      calLog.error('feed', 'Failed to create feed token', { userId: user.id, error })
      return NextResponse.json({ error: 'Could not create feed link' }, { status: 500 })
    }

    calLog.info('feed', 'Feed subscription link created (previous links revoked)', {
      userId: user.id, label,
    })

    const base = appBaseUrl()
    const httpsUrl = `${base}/api/calendar/feed/${token}`

    return NextResponse.json({
      url: httpsUrl,
      // webcal:// makes iOS/macOS open Calendar and offer to subscribe directly.
      webcalUrl: httpsUrl.replace(/^https?:\/\//, 'webcal://'),
    })
  } catch (err) {
    calLog.error('feed', 'Unhandled error creating feed link', { error: err })
    return NextResponse.json({ error: 'Could not create feed link' }, { status: 500 })
  }
}

export async function DELETE() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const service = await calendarDb()
    await service
      .from('calendar_feed_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .is('revoked_at', null)

    calLog.info('feed', 'Feed subscription links revoked', { userId: user.id })

    return NextResponse.json({ ok: true })
  } catch (err) {
    calLog.error('feed', 'Unhandled error revoking feed link', { error: err })
    return NextResponse.json({ error: 'Could not revoke feed link' }, { status: 500 })
  }
}
