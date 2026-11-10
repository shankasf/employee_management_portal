import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { getTodayNY } from '@/lib/utils'

export const dynamic = 'force-dynamic'

function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function saveCronLog(
  supabaseAdmin: ReturnType<typeof createAdminClient>,
  runDate: string,
  status: 'success' | 'error',
  summary: string,
  details: Record<string, unknown>
) {
  try {
    await supabaseAdmin.from('cron_logs').insert({
      cron_name: 'cleanup-notifications',
      run_date: runDate,
      status,
      summary,
      details,
    })
  } catch (err) {
    console.error('[cleanup-notifications] Failed to save cron log:', err)
  }
}

/**
 * Cron endpoint that deletes in-app notifications older than 7 days.
 *
 * Notifications past their first week stop being actionable and just clutter the
 * notifications tab, so any row with created_at older than 7 days is removed.
 *
 * Scheduled to run nightly.
 */
export async function GET(request: NextRequest) {
  const supabaseAdmin = createAdminClient()
  const today = getTodayNY()

  try {
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    if (!cronSecret) {
      console.error('[cleanup-notifications] CRON_SECRET not configured')
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

    const { data, error } = await supabaseAdmin
      .from('notifications')
      .delete()
      .lt('created_at', cutoff)
      .select('id')

    if (error) {
      const msg = `Failed to delete old notifications: ${error.message}`
      console.error(`[cleanup-notifications] ${msg}`)
      await saveCronLog(supabaseAdmin, today, 'error', msg, { error: error.message })
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }

    const deletedCount = (data || []).length
    const summary = `Deleted ${deletedCount} notification(s) older than 7 days`
    console.log(`[cleanup-notifications] ${summary}`)

    await saveCronLog(supabaseAdmin, today, 'success', summary, {
      deleted_count: deletedCount,
      cutoff,
    })

    return NextResponse.json({ deleted: deletedCount, cutoff, date: today })
  } catch (err) {
    console.error('[cleanup-notifications] Unexpected error:', err)
    await saveCronLog(supabaseAdmin, today, 'error', 'Unexpected error', {
      error: err instanceof Error ? err.message : 'unknown',
    })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
