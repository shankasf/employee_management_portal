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

    const { data: profile } = await supabase
        .from('profiles')
        .select('role, admin_scoped')
        .eq('id', user.id)
        .single()

    const _p = profile as { role: string; admin_scoped?: boolean } | null
    if (_p?.role !== 'admin') {
        return NextResponse.json({ error: 'Forbidden — Admin only' }, { status: 403 })
    }
    // The admin assistant is a company-wide tool; not available to scoped admins.
    if (_p?.admin_scoped) {
        return NextResponse.json({ error: 'Forbidden — company-wide function' }, { status: 403 })
    }

    if (!PROXY_SECRET) {
        return NextResponse.json(
            { error: 'Assistant is not configured. Set AGENT_PROXY_SECRET.' },
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
        const upstream = await fetch(`${AGENT_URL}/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Proxy-Secret': PROXY_SECRET,
            },
            body: JSON.stringify({ message, history }),
        })
        const text = await upstream.text()
        let data: unknown = null
        try { data = text ? JSON.parse(text) : null } catch { /* upstream returned non-JSON */ }
        if (!upstream.ok) {
            const detail = (data as { detail?: string } | null)?.detail
            return NextResponse.json(
                { error: detail || `Assistant error (${upstream.status})` },
                { status: upstream.status },
            )
        }
        return NextResponse.json(data)
    } catch (err) {
        console.error('[admin/assistant] upstream error', err)
        return NextResponse.json(
            { error: 'Assistant service is unreachable. Is agents_service running?' },
            { status: 502 },
        )
    }
}
