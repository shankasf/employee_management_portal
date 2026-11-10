import { NextRequest, NextResponse } from 'next/server'

import { safeEqual } from '@/lib/calendar/crypto'
import { pullFromProvider } from '@/lib/calendar/sync'
import type { CalendarConnectionRow } from '@/lib/calendar/types'
import { calendarDb } from '@/lib/calendar/db'
import { calLog, startTimer } from '@/lib/calendar/log'

/**
 * Microsoft Graph change-notification endpoint.
 *
 * Graph validates a new subscription by calling us with ?validationToken=…,
 * which must be echoed back as text/plain within 10 seconds or the
 * subscription is never created.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface GraphNotification {
  subscriptionId?: string
  clientState?: string
  resource?: string
}

export async function POST(request: NextRequest) {
  const validationToken = request.nextUrl.searchParams.get('validationToken')
  if (validationToken) {
    calLog.info('webhook', 'Microsoft subscription validation handshake')
    return new NextResponse(validationToken, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { value?: GraphNotification[] }
    const notifications = body.value || []
    if (!notifications.length) {
      calLog.warn('webhook', 'Microsoft notification with an empty payload')
      return NextResponse.json({ ok: true })
    }

    const elapsed = startTimer()
    calLog.info('webhook', 'Microsoft change notification received', {
      count: notifications.length,
    })

    const service = await calendarDb()

    // One payload can carry several notifications for the same subscription;
    // sync each connection at most once.
    const handled = new Set<string>()

    for (const note of notifications) {
      if (!note.subscriptionId || handled.has(note.subscriptionId)) continue
      handled.add(note.subscriptionId)

      const { data } = await service
        .from('calendar_connections')
        .select('*')
        .eq('watch_channel_id', note.subscriptionId)
        .maybeSingle()

      const conn = data as CalendarConnectionRow | null
      if (!conn) {
        calLog.warn('webhook', 'Microsoft notification for an unknown subscription', {
          subscriptionId: note.subscriptionId,
        })
        continue
      }
      if (conn.provider !== 'microsoft' || conn.status === 'revoked') {
        calLog.warn('webhook', 'Microsoft notification for a non-microsoft or revoked connection', {
          userId: conn.user_id, connectionId: conn.id, provider: conn.provider, status: conn.status,
        })
        continue
      }
      if (!conn.watch_secret || !note.clientState || !safeEqual(conn.watch_secret, note.clientState)) {
        calLog.error('webhook', 'Microsoft notification failed clientState verification — rejected', {
          userId: conn.user_id, connectionId: conn.id, subscriptionId: note.subscriptionId,
        })
        continue
      }

      const pull = await pullFromProvider(conn)
      await service
        .from('calendar_connections')
        .update({ last_synced_at: new Date().toISOString() })
        .eq('id', conn.id)

      calLog.info('webhook', 'Microsoft notification processed', {
        userId: conn.user_id, connectionId: conn.id, duration: elapsed(),
        cached: pull.cached, removed: pull.removed,
        cancelRequests: pull.cancelRequests, rescheduleRequests: pull.rescheduleRequests,
      })
    }
  } catch (err) {
    // Graph retries on failure and drops the subscription after repeated 5xx.
    calLog.error('webhook', 'Microsoft notification handling threw — returning 200', { error: err })
  }

  return NextResponse.json({ ok: true })
}
