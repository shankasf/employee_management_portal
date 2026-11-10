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
    if (!PROXY_SECRET) {
        return NextResponse.json({ error: 'Voice not configured' }, { status: 503 })
    }

    const body = await request.json().catch(() => null) as { text?: string; voice?: string } | null
    const text = body?.text?.toString().trim() || ''
    if (!text) {
        return NextResponse.json({ error: 'Empty text' }, { status: 400 })
    }

    try {
        const res = await fetch(`${AGENT_URL}/tts`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Proxy-Secret': PROXY_SECRET,
            },
            body: JSON.stringify({ text: text.slice(0, 4000), voice: body?.voice }),
        })
        if (!res.ok) {
            const errText = await res.text().catch(() => '')
            return NextResponse.json(
                { error: errText || `TTS failed (${res.status})` },
                { status: res.status },
            )
        }
        const buf = await res.arrayBuffer()
        return new NextResponse(buf, {
            status: 200,
            headers: {
                'Content-Type': 'audio/mpeg',
                'Cache-Control': 'no-store',
            },
        })
    } catch (err) {
        console.error('[voice/tts] upstream error', err)
        return NextResponse.json({ error: 'Voice service unreachable' }, { status: 502 })
    }
}
