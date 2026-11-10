import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerSupabase } from '@/lib/supabase/server'

function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(request: NextRequest) {
  try {
    // Auth check
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabaseAdmin = createAdminClient()

    // Admin role check
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role, admin_scoped')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    // Cron logs are a company-wide function; not available to scoped admins.
    if ((profile as { admin_scoped?: boolean }).admin_scoped) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Parse query params
    const { searchParams } = new URL(request.url)
    const cronName = searchParams.get('cron_name') || 'create-recurring-tasks'
    const limit = Math.min(parseInt(searchParams.get('limit') || '30'), 100)

    const { data: logs, error } = await supabaseAdmin
      .from('cron_logs')
      .select('*')
      .eq('cron_name', cronName)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.error('[cron-logs] Error:', error.message)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }

    return NextResponse.json({ logs })
  } catch (err) {
    console.error('[cron-logs] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
