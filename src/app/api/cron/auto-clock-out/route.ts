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

interface ClosedShift {
  id: string
  employee_id: string
  clock_in: string
  clock_out: string
  total_hours: number | null
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
      cron_name: 'auto-clock-out',
      run_date: runDate,
      status,
      summary,
      details,
    })
  } catch (err) {
    console.error('[auto-clock-out] Failed to save cron log:', err)
  }
}

/**
 * Cron endpoint that auto-closes forgotten/open attendance shifts.
 *
 * Any attendance_logs row still open (clock_out IS NULL) is closed at the END OF
 * THE NY DAY (23:59:59 America/New_York) of its own clock_in date, once that
 * moment has passed. total_hours is computed (and capped at scheduled hours when
 * a schedule exists) by the DB trigger. Each closed row is flagged
 * auto_clocked_out = true so admins can distinguish it from a real clock-out.
 *
 * Should run nightly shortly after midnight ET (scheduled at 05:30 UTC, which is
 * 00:30 ET in EST and 01:30 ET in EDT -- always after midnight ET).
 */
export async function GET(request: NextRequest) {
  const supabaseAdmin = createAdminClient()
  const today = getTodayNY()

  try {
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    if (!cronSecret) {
      console.error('[auto-clock-out] CRON_SECRET not configured')
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data, error } = await supabaseAdmin.rpc('auto_clock_out_open_shifts')

    if (error) {
      const msg = `Failed to auto clock-out: ${error.message}`
      console.error(`[auto-clock-out] ${msg}`)
      await saveCronLog(supabaseAdmin, today, 'error', msg, { error: error.message })
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }

    const closed = (data || []) as ClosedShift[]
    const summary = `Auto-closed ${closed.length} open shift(s)`
    console.log(`[auto-clock-out] ${summary}`)

    await saveCronLog(supabaseAdmin, today, 'success', summary, {
      closed_count: closed.length,
      closed: closed.map((c) => ({
        id: c.id,
        employee_id: c.employee_id,
        clock_in: c.clock_in,
        clock_out: c.clock_out,
        total_hours: c.total_hours,
      })),
    })

    return NextResponse.json({ closed: closed.length, date: today })
  } catch (err) {
    console.error('[auto-clock-out] Unexpected error:', err)
    await saveCronLog(supabaseAdmin, today, 'error', 'Unexpected error', {
      error: err instanceof Error ? err.message : 'unknown',
    })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
