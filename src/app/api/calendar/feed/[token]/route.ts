import { NextRequest, NextResponse } from 'next/server'

import { hashToken } from '@/lib/calendar/crypto'
import { buildIcs } from '@/lib/calendar/ics'
import { collectItems, defaultSyncWindow } from '@/lib/calendar/sources'
import { getPrefs } from '@/lib/calendar/sync'
import { calendarDb } from '@/lib/calendar/db'
import { calLog, startTimer } from '@/lib/calendar/log'

/**
 * Public ICS subscription feed.
 *
 * Calendar clients cannot present a session cookie, so this route authenticates
 * by the secret token in the URL (looked up by hash) and must stay unauthenticated
 * otherwise. This is the standard pattern used by Deputy, 7shifts and When I Work.
 *
 * This is the "Apple Calendar" path: Apple exposes no OAuth calendar API, so a
 * webcal:// subscription is the only one-tap option there. Clients re-poll on
 * their own schedule (Apple/Google typically a few hours), so it is a mirror,
 * not real-time — the OAuth path is what gives instant updates.
 */

export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params

  // Cheap shape check before touching the database.
  const elapsed = startTimer()

  if (!token || token.length < 20 || token.length > 200) {
    calLog.warn('feed', 'Feed request with a malformed token', { tokenLength: token?.length ?? 0 })
    return new NextResponse('Not found', { status: 404 })
  }

  const service = await calendarDb()
  const { data: row } = await service
    .from('calendar_feed_tokens')
    .select('id, user_id, revoked_at')
    .eq('token_hash', hashToken(token))
    .maybeSingle()

  const feed = row as { id: string; user_id: string; revoked_at: string | null } | null
  if (!feed || feed.revoked_at) {
    calLog.warn('feed', 'Feed request rejected', {
      reason: feed ? 'revoked' : 'unknown token',
    })
    return new NextResponse('Not found', { status: 404 })
  }

  try {
    const prefs = await getPrefs(feed.user_id)
    const items = await collectItems(feed.user_id, prefs, defaultSyncWindow())

    const { data: profile } = await service
      .from('profiles')
      .select('full_name')
      .eq('id', feed.user_id)
      .maybeSingle()
    const name = (profile as { full_name?: string } | null)?.full_name

    const ics = buildIcs(items, {
      calendarName: name ? `PlayFunia — ${name}` : 'PlayFunia',
      reminderMinutes: prefs.reminder_minutes,
      refreshIntervalMinutes: 60,
    })

    // Fire-and-forget usage stamp; never block the feed on it.
    service
      .from('calendar_feed_tokens')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', feed.id)
      .then(() => undefined, () => undefined)

    calLog.info('feed', 'ICS feed served', {
      userId: feed.user_id, duration: elapsed(),
      events: items.length, bytes: ics.length,
      userAgent: _request.headers.get('user-agent')?.slice(0, 80) || undefined,
    })

    return new NextResponse(ics, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="playfunia.ics"',
        // Subscribed clients poll; discourage intermediary caching.
        'Cache-Control': 'no-store, max-age=0',
      },
    })
  } catch (err) {
    calLog.error('feed', 'Failed to build ICS feed', {
      userId: feed.user_id, duration: elapsed(), error: err,
    })
    return new NextResponse('Unable to build calendar feed', { status: 500 })
  }
}
