/**
 * Bridge between the browser's realtime WebRTC session and our multi-agent
 * backend. The realtime model emits a `query_company_data` function call;
 * the browser POSTs the question here, and we forward to the appropriate
 * agent endpoint (admin or employee) so the real database is queried.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const AGENT_URL = process.env.AGENT_SERVICE_URL || 'http://127.0.0.1:8088'
const PROXY_SECRET = process.env.AGENT_PROXY_SECRET || ''

export async function POST(request: NextRequest) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => null) as
        | { mode?: 'admin' | 'employee'; question?: string }
        | null
    const mode = body?.mode === 'employee' ? 'employee' : 'admin'
    const question = (body?.question || '').toString().trim()
    if (!question) {
        return NextResponse.json({ error: 'Empty question' }, { status: 400 })
    }
    if (!PROXY_SECRET) {
        return NextResponse.json({ error: 'Not configured' }, { status: 503 })
    }

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Proxy-Secret': PROXY_SECRET,
    }

    let upstreamPath = '/chat'
    if (mode === 'admin') {
        const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single()
        if ((profile as { role: string } | null)?.role !== 'admin') {
            return NextResponse.json({ error: 'Admin only' }, { status: 403 })
        }
    } else {
        const { data: emp } = await supabase
            .from('employees')
            .select('id,display_name')
            .eq('id', user.id)
            .single()
        if (!emp) return NextResponse.json({ error: 'No employee record' }, { status: 403 })
        upstreamPath = '/employee/chat'
        headers['X-Employee-Id'] = (emp as { id: string }).id
        headers['X-Employee-Name'] =
            (emp as { display_name?: string | null }).display_name || ''
    }

    try {
        const res = await fetch(`${AGENT_URL}${upstreamPath}`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ message: question, history: [] }),
        })
        const text = await res.text()
        let data: unknown = null
        try { data = text ? JSON.parse(text) : null } catch { /* non-JSON */ }
        if (!res.ok) {
            return NextResponse.json(
                { error: (data as { detail?: string })?.detail || `Agent error (${res.status})` },
                { status: res.status },
            )
        }
        const reply = (data as { reply?: string } | null)?.reply || ''
        return NextResponse.json({ answer: reply })
    } catch (err) {
        console.error('[realtime/tool] error', err)
        return NextResponse.json({ error: 'Agent service unreachable' }, { status: 502 })
    }
}
