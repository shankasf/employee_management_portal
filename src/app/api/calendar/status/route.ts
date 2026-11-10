import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { hasEncryptionKey } from '@/lib/calendar/crypto'
import { getConnections, getPrefs } from '@/lib/calendar/sync'
import { googleConfigured, appBaseUrl } from '@/lib/calendar/providers/google'
import { microsoftConfigured } from '@/lib/calendar/providers/microsoft'
import { calendarDb } from '@/lib/calendar/db'
import { calLog } from '@/lib/calendar/log'

/**
 * Everything the Settings page needs: which providers are available, what the
 * user has connected, their sync preferences, and whether a feed link exists.
 *
 * Deliberately never returns tokens.
 */

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const [connections, prefs] = await Promise.all([getConnections(user.id), getPrefs(user.id)])

    const service = await calendarDb()
    const { data: feedRows } = await service
      .from('calendar_feed_tokens')
      .select('id, label, created_at, last_used_at')
      .eq('user_id', user.id)
      .is('revoked_at', null)
      .order('created_at', { ascending: false })

    const encryptionReady = hasEncryptionKey()

    return NextResponse.json({
      providers: {
        google: { available: googleConfigured() && encryptionReady },
        microsoft: { available: microsoftConfigured() && encryptionReady },
        // The ICS feed needs no OAuth app, so it always works.
        ics: { available: true },
      },
      connections: connections.map((c) => ({
        provider: c.provider,
        email: c.provider_account_email,
        status: c.status,
        calendarName: c.target_calendar_name,
        lastSyncedAt: c.last_synced_at,
        lastError: c.last_error,
        // A live push channel means near-instant updates.
        realtime: Boolean(c.watch_expires_at && new Date(c.watch_expires_at) > new Date()),
      })),
      prefs,
      feed: {
        // The raw token is only shown once, at generation time.
        exists: (feedRows || []).length > 0,
        count: (feedRows || []).length,
      },
      baseUrl: appBaseUrl(),
    })
  } catch (err) {
    calLog.error('api', 'Failed to load calendar status', { error: err })
    return NextResponse.json({ error: 'Failed to load calendar status' }, { status: 500 })
  }
}
