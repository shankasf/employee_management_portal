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

    const form = await request.formData().catch(() => null)
    const audio = form?.get('audio')
    if (!(audio instanceof Blob)) {
        return NextResponse.json({ error: 'Missing audio' }, { status: 400 })
    }
    if (audio.size > 25 * 1024 * 1024) {
        return NextResponse.json({ error: 'Audio too large' }, { status: 413 })
    }

    const upstream = new FormData()
    upstream.append('audio', audio, 'audio.webm')

    try {
        const res = await fetch(`${AGENT_URL}/transcribe`, {
            method: 'POST',
            headers: { 'X-Proxy-Secret': PROXY_SECRET },
            body: upstream,
        })
        const text = await res.text()
        let data: unknown = null
        try { data = text ? JSON.parse(text) : null } catch { /* non-JSON */ }
        if (!res.ok) {
            const detail = (data as { detail?: string } | null)?.detail
            return NextResponse.json(
                { error: detail || `Transcription failed (${res.status})` },
                { status: res.status },
            )
        }
        return NextResponse.json(data)
    } catch (err) {
        console.error('[voice/transcribe] upstream error', err)
        return NextResponse.json({ error: 'Voice service unreachable' }, { status: 502 })
    }
}
