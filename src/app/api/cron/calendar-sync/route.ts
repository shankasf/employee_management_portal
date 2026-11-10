import { NextRequest, NextResponse } from 'next/server'

import { ensureWatch, getPrefs, syncConnection } from '@/lib/calendar/sync'
import type { CalendarConnectionRow } from '@/lib/calendar/types'
import { calendarDb } from '@/lib/calendar/db'
import { calLog } from '@/lib/calendar/log'

/**
 * Periodic calendar reconcile.
 *
 * Push channels are the fast path but Google explicitly does not guarantee a
 * notification for every change, and channels expire within days. This job is
 * the safety net: it renews expiring channels and re-runs a full push/pull for
 * every active connection.
 *
 * Suggested crontab (hourly):
 *   0 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
 *     https://admin.playfunia.com/api/cron/calendar-sync
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('[calendar-sync] CRON_SECRET not configured')
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    calLog.warn('cron', 'Unauthorized calendar-sync cron attempt', {
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined,
    })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  calLog.info('cron', 'Calendar reconcile started')

  const started = Date.now()
  const summary = {
    connections: 0,
    synced: 0,
    watchesRenewed: 0,
    needsReauth: 0,
    failed: 0,
  }

  try {
    const service = await calendarDb()
    const { data } = await service
      .from('calendar_connections')
      .select('*')
      .neq('status', 'revoked')
      .order('last_synced_at', { ascending: true, nullsFirst: true })

    const connections = (data || []) as CalendarConnectionRow[]
    summary.connections = connections.length

    // Cache preferences per user — a user may have two connections.
    const prefsCache = new Map<string, Awaited<ReturnType<typeof getPrefs>>>()

    for (const conn of connections) {
      // Leave headroom so a long run cannot be killed mid-write.
      if (Date.now() - started > 240_000) {
        calLog.warn('cron', 'Time budget reached — deferring remaining connections to next run', {
          processed: summary.synced + summary.failed + summary.needsReauth,
          total: connections.length,
        })
        break
      }

      try {
        let prefs = prefsCache.get(conn.user_id)
        if (!prefs) {
          prefs = await getPrefs(conn.user_id)
          prefsCache.set(conn.user_id, prefs)
        }

        const result = await syncConnection(conn, prefs)
        if (result.status === 'ok') summary.synced++
        else if (result.status === 'needs_reauth') summary.needsReauth++
        else summary.failed++

        if (result.status === 'ok') {
          const before = conn.watch_expires_at
          await ensureWatch(conn).catch(() => null)
          // ensureWatch is a no-op unless the channel is close to expiring.
          const { data: after } = await service
            .from('calendar_connections')
            .select('watch_expires_at')
            .eq('id', conn.id)
            .maybeSingle()
          const afterExp = (after as { watch_expires_at: string | null } | null)?.watch_expires_at
          if (afterExp && afterExp !== before) summary.watchesRenewed++
        }
      } catch (err) {
        summary.failed++
        calLog.error('cron', 'Connection failed during reconcile', {
          userId: conn.user_id, connectionId: conn.id, provider: conn.provider, error: err,
        })
      }
    }

    calLog.info('cron', 'Calendar reconcile finished', {
      duration: Date.now() - started, ...summary,
    })

    return NextResponse.json({ ok: true, ...summary, durationMs: Date.now() - started })
  } catch (err) {
    calLog.error('cron', 'Calendar reconcile failed fatally', {
      duration: Date.now() - started, error: err,
    })
    return NextResponse.json({ error: 'Calendar sync failed' }, { status: 500 })
  }
}
