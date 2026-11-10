import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const AGENT_URL = process.env.AGENT_SERVICE_URL || 'http://127.0.0.1:8088'
const PROXY_SECRET = process.env.AGENT_PROXY_SECRET || ''

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify the user has an employee record. Admins can also chat as
    // themselves if they happen to have an employee row; that's harmless
    // because they only see their own data through this endpoint.
    const { data: employee } = await supabase
        .from('employees')
        .select('id,display_name')
        .eq('id', user.id)
        .single()

    if (!employee) {
        return NextResponse.json({ error: 'No employee record' }, { status: 403 })
    }

    if (!PROXY_SECRET) {
        return NextResponse.json(
            { error: 'Assistant is not configured.' },
            { status: 503 },
        )
    }

    const body = await request.json().catch(() => null) as
        | { message?: string; history?: Array<{ role: string; content: string }> }
        | null
    const message = body?.message?.toString().trim() || ''
    const history = Array.isArray(body?.history) ? body!.history!.slice(-20) : []
    if (!message) {
        return NextResponse.json({ error: 'Empty message' }, { status: 400 })
    }

    try {
        const upstream = await fetch(`${AGENT_URL}/employee/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Proxy-Secret': PROXY_SECRET,
                'X-Employee-Id': (employee as { id: string }).id,
                'X-Employee-Name': (employee as { display_name?: string | null }).display_name || '',
            },
            body: JSON.stringify({ message, history }),
        })
        const text = await upstream.text()
        let data: unknown = null
        try { data = text ? JSON.parse(text) : null } catch { /* non-JSON upstream */ }
        if (!upstream.ok) {
            const detail = (data as { detail?: string } | null)?.detail
            return NextResponse.json(
                { error: detail || `Assistant error (${upstream.status})` },
                { status: upstream.status },
            )
        }
        return NextResponse.json(data)
    } catch (err) {
        console.error('[employee/assistant] upstream error', err)
        return NextResponse.json(
            { error: 'Assistant service is unreachable.' },
            { status: 502 },
        )
    }
}
