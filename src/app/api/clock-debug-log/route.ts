import { createClient as createServerClient } from '@/lib/supabase/server'
import { createUntypedServiceClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

const ALLOWED_ACTIONS = new Set(['clock_in', 'clock_out'])
const ALLOWED_STATUSES = new Set(['pass', 'fail', 'info', 'success'])

export async function POST(request: NextRequest) {
    try {
        // Authenticate user
        const supabase = await createServerClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            // Still return 200 — don't block the client
            return NextResponse.json({ success: true })
        }

        // Get email from profile
        const { data: profile } = await supabase
            .from('profiles')
            .select('email')
            .eq('id', user.id)
            .single()

        const body = await request.json()
        const { action, step, status, message, details, device_id, device_name, user_agent, env_info } = body as {
            action: string
            step: string
            status: string
            message: string
            details?: Record<string, unknown>
            device_id?: string | null
            device_name?: string | null
            user_agent?: string | null
            env_info?: Record<string, unknown> | null
        }

        // Validate required fields
        if (!action || !step || !status || !message) {
            return NextResponse.json({ success: true })
        }

        // Validate allowed values
        if (!ALLOWED_ACTIONS.has(action) || !ALLOWED_STATUSES.has(status)) {
            return NextResponse.json({ success: true })
        }

        // Truncate message to prevent abuse
        const safeMessage = String(message).slice(0, 500)
        const safeStep = String(step).slice(0, 100)

        const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
            request.headers.get('x-real-ip') || null

        // Merge step-specific details with environment info into one JSONB
        const enrichedDetails: Record<string, unknown> = {
            ...(details || {}),
            ...(env_info ? { env: env_info } : {}),
        }

        const serviceClient = await createUntypedServiceClient()
        const { error } = await serviceClient.from('clock_debug_logs').insert({
            employee_id: user.id,
            employee_email: (profile as { email: string } | null)?.email || user.email || 'unknown',
            action,
            step: safeStep,
            status,
            message: safeMessage,
            details: Object.keys(enrichedDetails).length > 0 ? enrichedDetails : null,
            device_id: device_id || null,
            device_name: device_name || null,
            user_agent: user_agent || null,
            ip_address: ipAddress,
        })

        if (error) {
            console.error('[ClockDebugLog] Insert error:', error.message)
        }

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('[ClockDebugLog] Error:', error)
        return NextResponse.json({ success: true })
    }
}

export async function GET(request: NextRequest) {
    try {
        // Authenticate + admin check
        const supabase = await createServerClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { data: profile } = await supabase
            .from('profiles')
            .select('role, admin_scoped')
            .eq('id', user.id)
            .single()

        const _p = profile as { role: string; admin_scoped?: boolean } | null
        if (!_p || _p.role !== 'admin') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }
        // Clock debug logs span all locations; not available to scoped admins.
        if (_p.admin_scoped) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        const { searchParams } = new URL(request.url)
        const employeeFilter = searchParams.get('employee') || 'all'
        const actionFilter = searchParams.get('action') || 'all'
        const statusFilter = searchParams.get('status') || 'all'
        const limit = Math.min(parseInt(searchParams.get('limit') || '200'), 500)

        const serviceClient = await createUntypedServiceClient()
        let query = serviceClient
            .from('clock_debug_logs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(limit)

        if (employeeFilter !== 'all') {
            query = query.eq('employee_id', employeeFilter)
        }
        if (actionFilter !== 'all') {
            query = query.eq('action', actionFilter)
        }
        if (statusFilter !== 'all') {
            query = query.eq('status', statusFilter)
        }

        const { data, error } = await query

        if (error) {
            console.error('[ClockDebugLog] GET error:', error.message)
            return NextResponse.json({ error: 'Failed to fetch logs' }, { status: 500 })
        }

        return NextResponse.json(data || [])
    } catch (error) {
        console.error('[ClockDebugLog] GET error:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
