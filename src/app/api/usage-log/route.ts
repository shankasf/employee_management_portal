import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// Create admin client with service role key for inserting logs
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

interface UsageLogEntry {
    eventType: string
    eventCategory: string
    eventAction: string
    eventLabel?: string
    pagePath?: string
    pageTitle?: string
    metadata?: Record<string, unknown>
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

        // Parse request body
        const body = await request.json()
        const { logs, sessionId } = body as { logs: UsageLogEntry[], sessionId: string }

        if (!logs || !Array.isArray(logs) || logs.length === 0) {
            return NextResponse.json({ success: true, message: 'No logs to process' })
        }

        // Limit batch size to prevent abuse
        const MAX_LOGS_PER_REQUEST = 100
        if (logs.length > MAX_LOGS_PER_REQUEST) {
            return NextResponse.json({ error: 'Too many logs in a single request' }, { status: 400 })
        }

        // Get request info
        const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
            request.headers.get('x-real-ip') || null
        const userAgent = request.headers.get('user-agent') || null

        // Prepare logs for insertion
        const adminClient = createAdminClient()
        const logsToInsert = logs.map(log => ({
            user_id: user?.id || null,
            user_email: user?.email || null,
            user_role: userRole,
            event_type: log.eventType,
            event_category: log.eventCategory,
            event_action: log.eventAction,
            event_label: log.eventLabel || null,
            page_path: log.pagePath || null,
            page_title: log.pageTitle || null,
            metadata: log.metadata || null,
            session_id: sessionId || null,
            ip_address: ipAddress,
            user_agent: userAgent,
        }))

        // Insert logs (fire-and-forget style, don't block response)
        const { error } = await adminClient.from('usage_logs').insert(logsToInsert)

        if (error) {
            console.error('[UsageLog API] Insert error:', error)
            // Don't return error to client - logging should be transparent
        } else {
            console.log(`[UsageLog API] Logged ${logs.length} events for ${user?.email || 'anonymous'}`)
        }

        return NextResponse.json({ success: true, count: logs.length })

    } catch (error) {
        console.error('[UsageLog API] Error:', error)
        // Return success anyway - don't disrupt client
        return NextResponse.json({ success: true })
    }
}
