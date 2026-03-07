import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

const ALLOWED_ACTIONS = new Set([
    'task_created',
    'task_updated',
    'task_deleted',
    'task_assigned',
    'task_bulk_assigned',
    'task_bulk_deleted',
    'task_instance_status_updated',
    'task_instance_deleted',
    'task_completed',
    'task_submission_updated',
    'tasks_loaded',
    'tasks_load_failed',
])

function createAdminClient() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    return createClient(supabaseUrl, serviceRoleKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    })
}

export async function POST(request: NextRequest) {
    try {
        const supabase = await createServerClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ success: true })
        }

        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('email')
            .eq('id', user.id)
            .single()

        if (profileError) {
            console.error('[ActivityLog] Profile fetch error:', profileError.message)
        }

        const body = await request.json()
        const { action, entityType, entityId, entityName, details } = body as {
            action: string
            entityType: string
            entityId?: string
            entityName?: string
            details?: Record<string, unknown>
        }

        if (!action || !entityType || !ALLOWED_ACTIONS.has(action)) {
            return NextResponse.json({ success: true })
        }

        const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
            request.headers.get('x-real-ip') || null
        const userAgent = request.headers.get('user-agent') || null

        const adminClient = createAdminClient()
        const { error } = await adminClient.from('activity_logs').insert({
            admin_id: user.id,
            admin_email: (profile as { email: string } | null)?.email || user.email || 'unknown',
            action,
            entity_type: entityType,
            entity_id: entityId || null,
            entity_name: entityName || null,
            details: details || null,
            ip_address: ipAddress,
            user_agent: userAgent,
        })

        if (error) {
            console.error('[ActivityLog API] Insert error:', error.message)
        }

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('[ActivityLog API] Error:', error)
        return NextResponse.json({ success: true })
    }
}
