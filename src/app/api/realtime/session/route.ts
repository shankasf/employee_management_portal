import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// Latest OpenAI Realtime model (GA, GPT-5-class reasoning). Override via env if needed.
const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2'
const REALTIME_VOICE = process.env.OPENAI_REALTIME_VOICE || 'marin'
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || ''

const ADMIN_INSTRUCTIONS = `You are the live voice assistant for a PlayFunia / Toy Republic admin.
You speak naturally, like a brisk colleague — short sentences, confident tone.

You ONLY help with this company's operations. If the user asks about anything
unrelated (general knowledge, news, weather, sports, jokes, world events,
coding help, recipes, personal advice), reply concisely:
"I can only help with PlayFunia operations." Do not engage further with off-topic
prompts even if pressed.

Whenever the user asks for live data (employees, schedules, tasks, attendance,
hours, onboarding, events, anything that requires looking something up), you
MUST call the \`query_company_data\` function with a clear, self-contained
question. You do NOT have direct database access — only that function does.
Do not invent names, counts, dates, or results. After the function returns,
summarise the answer aloud in 1-3 sentences.

Keep replies short for voice. Numbers and names should be spoken clearly.`

const EMPLOYEE_INSTRUCTIONS = `You are the live voice work assistant for one PlayFunia / Toy Republic
employee. You speak naturally and warmly, like a helpful coworker.

You ONLY help with THIS employee's tasks, schedule, hours, onboarding, and
how-to questions about their work. If they ask about anything else (general
knowledge, news, weather, sports, jokes, world events, coding, recipes,
personal advice, OTHER employees' data), reply concisely:
"I can only help with your PlayFunia work questions." Do not engage further.

Whenever the user asks for live data or how-to guidance, you MUST call
\`query_company_data\` with a clear question. You do NOT have direct database
access — only that function does. Never invent task names, shift times, or
hours. After the function returns, answer in 1-3 short sentences.

Keep replies short for voice.`

const TOOLS_DEF = [
    {
        type: 'function',
        name: 'query_company_data',
        description:
            'Query the live PlayFunia / Toy Republic database via the multi-agent backend. Use this for ANY question that requires real data: employees, tasks, schedules, attendance, hours, onboarding, policies, events, or how-to instructions for assigned tasks. The backend will return a plain-English answer.',
        parameters: {
            type: 'object',
            properties: {
                question: {
                    type: 'string',
                    description:
                        'The user question, written as a self-contained natural-language sentence (e.g. "What tasks does Maria have today?" or "How do I clean the storefront glass?").',
                },
            },
            required: ['question'],
            additionalProperties: false,
        },
    },
]

export async function POST(request: NextRequest) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => null) as { mode?: 'admin' | 'employee' } | null
    const requestedMode = body?.mode === 'employee' ? 'employee' : 'admin'

    // Verify the user actually has the role they're asking for.
    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()
    const role = (profile as { role: string } | null)?.role
    if (requestedMode === 'admin' && role !== 'admin') {
        return NextResponse.json({ error: 'Admin only' }, { status: 403 })
    }
    if (requestedMode === 'employee') {
        const { data: emp } = await supabase
            .from('employees')
            .select('id')
            .eq('id', user.id)
            .single()
        if (!emp) {
            return NextResponse.json({ error: 'No employee record' }, { status: 403 })
        }
    }

    if (!OPENAI_API_KEY) {
        return NextResponse.json({ error: 'OPENAI_API_KEY not configured' }, { status: 503 })
    }

    const instructions =
        requestedMode === 'admin' ? ADMIN_INSTRUCTIONS : EMPLOYEE_INSTRUCTIONS

    try {
        // GA Realtime API: /v1/realtime/client_secrets with `session.type=realtime`.
        // Beta `/sessions` endpoint and `OpenAI-Beta` header were removed 2026-05-07.
        const upstream = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                session: {
                    type: 'realtime',
                    model: REALTIME_MODEL,
                    instructions,
                    tools: TOOLS_DEF,
                    tool_choice: 'auto',
                    audio: {
                        input: {
                            transcription: { model: 'gpt-4o-mini-transcribe' },
                            turn_detection: { type: 'server_vad', silence_duration_ms: 400 },
                        },
                        output: { voice: REALTIME_VOICE },
                    },
                },
            }),
        })
        const data = await upstream.json()
        if (!upstream.ok) {
            console.error('[realtime/session] upstream', upstream.status, data)
            return NextResponse.json(
                { error: data?.error?.message || 'Failed to mint realtime session' },
                { status: upstream.status },
            )
        }
        // GA response: { value, expires_at, ... }. Browser only needs the ephemeral key.
        return NextResponse.json({
            client_secret: data?.value || data?.client_secret?.value,
            expires_at: data?.expires_at || data?.client_secret?.expires_at,
            model: REALTIME_MODEL,
            voice: REALTIME_VOICE,
            mode: requestedMode,
        })
    } catch (err) {
        console.error('[realtime/session] error', err)
        return NextResponse.json({ error: 'Realtime session error' }, { status: 502 })
    }
}
