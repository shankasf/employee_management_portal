import { NextRequest, NextResponse } from 'next/server'

import { safeEqual } from '@/lib/calendar/crypto'
import { pullFromProvider } from '@/lib/calendar/sync'
import type { CalendarConnectionRow } from '@/lib/calendar/types'
import { calendarDb } from '@/lib/calendar/db'
import { calLog, startTimer } from '@/lib/calendar/log'

/**
 * Google Calendar push endpoint.
 *
 * Google POSTs a bare "something changed" ping with no body — the channel id
 * and our client token arrive as headers. We authenticate on the token, then
 * run an incremental pull for that connection.
 *
 * Must always return 2xx quickly: repeated non-2xx responses make Google drop
 * the channel entirely.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const channelId = request.headers.get('x-goog-channel-id')
  const clientToken = request.headers.get('x-goog-channel-token')
  const resourceState = request.headers.get('x-goog-resource-state')

  if (!channelId) {
    calLog.warn('webhook', 'Google ping with no channel id — ignoring')
    return NextResponse.json({ ok: true })
  }

  // The handshake ping fires on channel creation and carries no changes.
  if (resourceState === 'sync') {
    calLog.info('webhook', 'Google channel handshake received', { channelId })
    return NextResponse.json({ ok: true })
  }

  const elapsed = startTimer()
  calLog.info('webhook', 'Google change notification received', { channelId, resourceState })

  try {
    const service = await calendarDb()
    const { data } = await service
      .from('calendar_connections')
      .select('*')
      .eq('watch_channel_id', channelId)
      .maybeSingle()

    const conn = data as CalendarConnectionRow | null

    // Unknown channel, or a token that does not match — ignore silently rather
    // than leaking which channel ids exist.
    if (!conn) {
      calLog.warn('webhook', 'Google notification for an unknown channel — likely a stale channel', {
        channelId,
      })
      return NextResponse.json({ ok: true })
    }
    if (!conn.watch_secret || !clientToken || !safeEqual(conn.watch_secret, clientToken)) {
      calLog.error('webhook', 'Google notification failed token verification — rejected', {
        userId: conn.user_id, connectionId: conn.id, channelId,
      })
      return NextResponse.json({ ok: true })
    }
    if (conn.provider !== 'google' || conn.status === 'revoked') {
      calLog.warn('webhook', 'Google notification for a non-google or revoked connection', {
        userId: conn.user_id, connectionId: conn.id, provider: conn.provider, status: conn.status,
      })
      return NextResponse.json({ ok: true })
    }

    const pull = await pullFromProvider(conn)

    await service
      .from('calendar_connections')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('id', conn.id)

    calLog.info('webhook', 'Google notification processed', {
      userId: conn.user_id, connectionId: conn.id, duration: elapsed(),
      cached: pull.cached, removed: pull.removed,
      cancelRequests: pull.cancelRequests, rescheduleRequests: pull.rescheduleRequests,
    })
  } catch (err) {
    // Swallow: a 500 here costs us the channel.
    calLog.error('webhook', 'Google notification handling threw — returning 200 to keep the channel', {
      channelId, duration: elapsed(), error: err,
    })
  }

  return NextResponse.json({ ok: true })
}
