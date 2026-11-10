import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerSupabase } from '@/lib/supabase/server'

function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

/**
 * Admin-only audit endpoint for SMS compliance.
 *   GET /api/admin/sms-logs            -> recent send attempts + summary counts
 *   GET /api/admin/sms-logs?view=unsubscribes -> the opt-out registry
 *   Optional: ?status=failed&phone=+1...&limit=50
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabaseAdmin = createAdminClient()
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role, admin_scoped')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    // SMS logs are a company-wide function; not available to scoped admins.
    if ((profile as { admin_scoped?: boolean }).admin_scoped) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const view = searchParams.get('view')
    const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10) || 100, 500)

    if (view === 'unsubscribes') {
      const { data, error } = await supabaseAdmin
        .from('sms_unsubscribes')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(limit)
      if (error) {
        console.error('[sms-logs] unsubscribes query failed:', error.message)
        return NextResponse.json({ error: 'Query failed' }, { status: 500 })
      }
      return NextResponse.json({ unsubscribes: data || [] })
    }

    let query = supabaseAdmin
      .from('sms_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)

    const status = searchParams.get('status')
    if (status) query = query.eq('status', status)
    const phone = searchParams.get('phone')
    if (phone) query = query.eq('phone', phone)
    const errorCode = searchParams.get('error_code')
    if (errorCode) query = query.eq('error_code', errorCode)

    const { data: logs, error } = await query
    if (error) {
      console.error('[sms-logs] logs query failed:', error.message)
      return NextResponse.json({ error: 'Query failed' }, { status: 500 })
    }

    return NextResponse.json({ logs: logs || [] })
  } catch (error) {
    console.error('[sms-logs] Unexpected error:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
