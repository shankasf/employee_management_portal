import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// Service role client for inserting logs
function createAdminClient() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    return createClient(supabaseUrl, serviceRoleKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    })
}

interface UploadLogEntry {
    status: string
    bucket: string
    fileName: string
    fileSize: number
    mimeType: string
    filePath?: string
    uploadContext: string
    entityId?: string
    errorMessage?: string
    errorCode?: string
    deviceName?: string
    durationMs?: number
}

export async function POST(request: NextRequest) {
    try {
        // Get user info if authenticated
        const supabase = await createServerClient()
        const { data: { user } } = await supabase.auth.getUser()

        let userRole: string | null = null
        if (user) {
            const { data: profile } = await supabase
                .from('profiles')
                .select('role')
                .eq('id', user.id)
                .single()
            userRole = (profile as { role: string } | null)?.role || null
        }

        const body = await request.json()
        const { logs } = body as { logs: UploadLogEntry[] }

        if (!logs || !Array.isArray(logs) || logs.length === 0) {
            return NextResponse.json({ success: true, message: 'No logs to process' })
        }

        // Limit batch size
        if (logs.length > 50) {
            return NextResponse.json({ error: 'Too many logs in a single request' }, { status: 400 })
        }

        const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
            request.headers.get('x-real-ip') || null
        const userAgent = request.headers.get('user-agent') || null

        const adminClient = createAdminClient()
        const logsToInsert = logs.map(log => ({
            user_id: user?.id || null,
            user_email: user?.email || null,
            user_role: userRole,
            status: log.status,
            bucket: log.bucket || null,
            file_name: log.fileName || null,
            file_size: log.fileSize || null,
            mime_type: log.mimeType || null,
            file_path: log.filePath || null,
            upload_context: log.uploadContext || null,
            entity_id: log.entityId || null,
            error_message: log.errorMessage || null,
            error_code: log.errorCode || null,
            user_agent: userAgent,
            device_name: log.deviceName || null,
            ip_address: ipAddress,
            duration_ms: log.durationMs || null,
        }))

        const { error } = await adminClient.from('upload_logs').insert(logsToInsert)

        if (error) {
            console.error('[UploadLog API] Insert error:', error)
        }

        return NextResponse.json({ success: true, count: logs.length })
    } catch (error) {
        console.error('[UploadLog API] Error:', error)
        return NextResponse.json({ success: true })
    }
}

// GET endpoint for admin to fetch upload logs
export async function GET(request: NextRequest) {
    try {
        const supabase = await createServerClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Check admin role
        const { data: profile } = await supabase
            .from('profiles')
            .select('role, admin_scoped')
            .eq('id', user.id)
            .single()

        const _p = profile as { role: string; admin_scoped?: boolean } | null
        if (_p?.role !== 'admin') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }
        // Upload logs are a company-wide diagnostic; not available to scoped admins.
        if (_p?.admin_scoped) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        const { searchParams } = new URL(request.url)
        const status = searchParams.get('status')
        const limit = Math.min(parseInt(searchParams.get('limit') || '200'), 500)

        const adminClient = createAdminClient()
        let query = adminClient
            .from('upload_logs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(limit)

        if (status && status !== 'all') {
            query = query.eq('status', status)
        }

        const { data, error } = await query

        if (error) {
            console.error('[UploadLog API] Fetch error:', error)
            return NextResponse.json({ error: 'Failed to fetch logs' }, { status: 500 })
        }

        return NextResponse.json(data || [])
    } catch (error) {
        console.error('[UploadLog API] Error:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
