'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { startRealtime, type RealtimeSession, type RealtimeStatus } from '@/lib/realtime'

interface Message {
    role: 'user' | 'assistant'
    content: string
    agent?: string
    handoffs?: string[]
}

interface ChatbotConfig {
    /** Mode controls endpoint, theme accent, default examples, expand-page link. */
    mode: 'admin' | 'employee'
    /** Render inline (no FAB, no fixed positioning). Used by full-page routes. */
    inline?: boolean
}

const ADMIN_PROMPTS = [
    'Which employees have completed onboarding?',
    "Who's clocked in right now?",
    'Show me overdue tasks for this week',
    "Did Maria finish today's tasks?",
    "Who's working tomorrow?",
    'How many hours did John work last week?',
    'Any pending shift cancellation requests?',
    'Show late arrivals from the last 7 days',
]

const EMPLOYEE_PROMPTS = [
    'What tasks do I have today?',
    'When is my next shift?',
    'How do I clean the storefront glass?',
    'How many hours did I work this week?',
    'Am I clocked in?',
    'Do I have any shifts to confirm?',
    'Show me my onboarding videos',
    "What's our refund policy?",
]

interface Theme {
    endpoint: string
    expandHref: string
    title: string
    subtitle: string
    examplePrompts: string[]
    accentBadge: string
}

function getTheme(mode: ChatbotConfig['mode']): Theme {
    if (mode === 'admin') {
        return {
            endpoint: '/api/admin/assistant',
            expandHref: '/admin/assistant',
            title: 'Admin Assistant',
            subtitle: '6 specialist agents · live data',
            examplePrompts: ADMIN_PROMPTS,
            accentBadge: 'Admin',
        }
    }
    return {
        endpoint: '/api/employee/assistant',
        expandHref: '/employee/assistant',
        title: 'Work Assistant',
        subtitle: 'Tasks · Schedule · How-to',
        examplePrompts: EMPLOYEE_PROMPTS,
        accentBadge: 'Employee',
    }
}

// ─────────────────────── Voice (OpenAI STT) ───────────────────────
// STT: gpt-4o-mini-transcribe (fallback whisper-1)
// Browser captures audio with MediaRecorder and POSTs to /api/voice/transcribe.

function isMicSupported(): boolean {
    if (typeof window === 'undefined') return false
    return !!(navigator.mediaDevices && typeof MediaRecorder !== 'undefined')
}

function pickRecorderMime(): string | undefined {
    if (typeof MediaRecorder === 'undefined') return undefined
    const candidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4',
    ]
    for (const m of candidates) {
        if (MediaRecorder.isTypeSupported?.(m)) return m
    }
    return undefined
}

// ─────────────────────── Component ───────────────────────
export default function Chatbot({ mode, inline = false }: ChatbotConfig) {
    const theme = getTheme(mode)
    const [open, setOpen] = useState(inline)
    const [mounted, setMounted] = useState(inline)
    const [messages, setMessages] = useState<Message[]>([])
    const [input, setInput] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [listening, setListening] = useState(false)
    const [transcribing, setTranscribing] = useState(false)
    const [voiceSupported, setVoiceSupported] = useState(false)
    const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('idle')
    const [realtimeTranscript, setRealtimeTranscript] = useState('')
    const realtimeRef = useRef<RealtimeSession | null>(null)
    const mediaRecorderRef = useRef<MediaRecorder | null>(null)
    const audioStreamRef = useRef<MediaStream | null>(null)
    const scrollRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        setVoiceSupported(isMicSupported())
    }, [])

    const stopRealtime = useCallback(() => {
        realtimeRef.current?.stop()
        realtimeRef.current = null
        setRealtimeStatus('idle')
        setRealtimeTranscript('')
    }, [])

    const startLiveCall = useCallback(async () => {
        if (realtimeRef.current) return
        setError(null)
        try {
            const session = await startRealtime(mode, {
                onStatus: (s) => setRealtimeStatus(s),
                onUserTranscript: (txt) => {
                    if (!txt.trim()) return
                    setMessages((prev) => [...prev, { role: 'user', content: txt }])
                },
                onAssistantTranscript: (txt, done) => {
                    if (done) {
                        setMessages((prev) => [
                            ...prev,
                            { role: 'assistant', content: txt, agent: 'Live (gpt-realtime)' },
                        ])
                        setRealtimeTranscript('')
                    } else {
                        setRealtimeTranscript(txt)
                    }
                },
                onError: (msg) => setError(msg),
            })
            realtimeRef.current = session
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to start live mode')
            setRealtimeStatus('error')
        }
    }, [mode])

    useEffect(() => {
        if (open) setMounted(true)
    }, [open])

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
    }, [messages, loading, open])

    useEffect(() => {
        return () => {
            try { mediaRecorderRef.current?.stop() } catch { /* no-op */ }
            audioStreamRef.current?.getTracks().forEach((t) => t.stop())
            realtimeRef.current?.stop()
        }
    }, [])

    const send = useCallback(
        async (text: string): Promise<void> => {
            const trimmed = text.trim()
            if (!trimmed || loading) return
            setError(null)
            const next: Message[] = [...messages, { role: 'user', content: trimmed }]
            setMessages(next)
            setInput('')
            setLoading(true)
            try {
                const res = await fetch(theme.endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        message: trimmed,
                        history: messages.map(({ role, content }) => ({ role, content })),
                    }),
                })
                const data = await res.json().catch(() => null)
                if (!res.ok) {
                    setError(data?.error || `Request failed (${res.status})`)
                    return
                }
                const reply = data?.reply || '(no reply)'
                setMessages([
                    ...next,
                    {
                        role: 'assistant',
                        content: reply,
                        agent: data?.agent,
                        handoffs: data?.handoffs || [],
                    },
                ])
            } catch (e) {
                setError(e instanceof Error ? e.message : 'Network error')
            } finally {
                setLoading(false)
            }
        },
        [loading, messages, theme.endpoint],
    )

    const onSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        send(input)
    }

    const startListening = async () => {
        if (!isMicSupported()) return
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
            audioStreamRef.current = stream
            const mime = pickRecorderMime()
            const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
            const chunks: BlobPart[] = []
            rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
            rec.onstop = async () => {
                const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' })
                stream.getTracks().forEach((t) => t.stop())
                audioStreamRef.current = null
                if (blob.size === 0) return
                setTranscribing(true)
                try {
                    const fd = new FormData()
                    fd.append('audio', blob, 'audio.webm')
                    const res = await fetch('/api/voice/transcribe', {
                        method: 'POST',
                        credentials: 'include',
                        body: fd,
                    })
                    const data = await res.json().catch(() => null) as { text?: string; error?: string } | null
                    if (!res.ok) {
                        setError(data?.error || `Voice failed (${res.status})`)
                        return
                    }
                    const text = (data?.text || '').trim()
                    if (text) {
                        await send(text)
                    }
                } finally {
                    setTranscribing(false)
                }
            }
            mediaRecorderRef.current = rec
            rec.start()
            setListening(true)
        } catch (e) {
            setListening(false)
            setError(e instanceof Error ? `Mic error: ${e.message}` : 'Mic permission denied')
        }
    }

    const stopListening = () => {
        try {
            const rec = mediaRecorderRef.current
            if (rec && rec.state !== 'inactive') rec.stop()
        } catch { /* no-op */ }
        setListening(false)
    }

    const expandToNewTab = () => {
        window.open(theme.expandHref, '_blank', 'noopener,noreferrer')
    }

    const panel = (
        <>
            {/* Header */}
            <div className="flex items-center gap-2.5 px-4 py-3 border-b bg-gradient-to-r from-card via-card to-card relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/5 via-fuchsia-500/5 to-amber-500/5 pointer-events-none" />
                <div className="relative">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-600 text-white flex items-center justify-center shadow-md">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.14 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z" fill="currentColor" stroke="none" />
                            <path d="M20 3v4M22 5h-4M4 17v2M5 18H3" />
                        </svg>
                    </div>
                    <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-card animate-pulse" />
                </div>
                <div className="flex-1 min-w-0 relative">
                    <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-sm truncate">{theme.title}</span>
                        <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-primary/10 text-primary font-semibold">
                            {theme.accentBadge}
                        </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">{theme.subtitle}</div>
                </div>
                <div className="relative flex items-center gap-0.5">
                    {!inline && (
                        <>
                            <button
                                type="button"
                                onClick={expandToNewTab}
                                title="Open in new tab"
                                className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                            >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M15 3h6v6" />
                                    <path d="M10 14L21 3" />
                                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                </svg>
                            </button>
                            <button
                                type="button"
                                onClick={() => { stopListening(); stopRealtime(); setOpen(false) }}
                                title="Minimize"
                                className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                            >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="5" y1="12" x2="19" y2="12" />
                                </svg>
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Live realtime status banner */}
            {realtimeStatus !== 'idle' && (
                <div className="px-4 py-2 border-b bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-cyan-500/10 flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                        {realtimeStatus === 'connecting' && (
                            <>
                                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                                <span className="font-medium">Connecting to live voice…</span>
                            </>
                        )}
                        {realtimeStatus === 'live' && (
                            <>
                                <span className="relative flex h-2 w-2">
                                    <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                                </span>
                                <span className="font-medium">Live with gpt-realtime · talk naturally</span>
                            </>
                        )}
                        {realtimeStatus === 'error' && (
                            <>
                                <span className="w-2 h-2 rounded-full bg-rose-500" />
                                <span className="font-medium text-rose-600 dark:text-rose-400">Voice error</span>
                            </>
                        )}
                        {realtimeStatus === 'closed' && (
                            <>
                                <span className="w-2 h-2 rounded-full bg-muted-foreground" />
                                <span className="font-medium">Disconnected</span>
                            </>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={stopRealtime}
                        className="px-2 py-1 rounded-md bg-rose-500 text-white text-[11px] font-medium hover:bg-rose-600 transition-colors"
                    >
                        End call
                    </button>
                </div>
            )}

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3 bg-background/40">
                {messages.length === 0 && realtimeStatus === 'idle' && (
                    <div className="h-full flex flex-col items-center justify-center text-center px-2">
                        <div className="text-4xl mb-3">💬</div>
                        <p className="text-base font-semibold mb-1">How can I help?</p>
                        <p className="text-xs text-muted-foreground mb-5 max-w-[260px]">
                            {mode === 'admin'
                                ? 'Ask about employees, schedules, tasks, attendance, onboarding, or events.'
                                : 'Ask about your tasks, schedule, hours, or how to do something at work.'}
                        </p>
                        <div className="grid grid-cols-1 gap-1.5 w-full max-w-xs">
                            {theme.examplePrompts.slice(0, 4).map((p) => (
                                <button
                                    key={p}
                                    type="button"
                                    onClick={() => send(p)}
                                    className="text-left text-xs px-3 py-2 rounded-lg border bg-card hover:bg-accent transition-colors flex items-center gap-2 group"
                                >
                                    <span className="opacity-40 group-hover:opacity-80 transition-opacity">›</span>
                                    <span className="truncate">{p}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {messages.map((m, i) => (
                    <div
                        key={i}
                        className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} animate-[slideIn_180ms_ease-out]`}
                    >
                        <div
                            className={`max-w-[85%] rounded-2xl px-3 py-2 shadow-sm ${
                                m.role === 'user'
                                    ? 'bg-primary text-primary-foreground rounded-br-sm'
                                    : 'bg-card border rounded-bl-sm'
                            }`}
                        >
                            {m.role === 'assistant' && m.agent && (
                                <div className="text-[10px] uppercase tracking-wide opacity-60 mb-1 font-medium">
                                    {m.agent}
                                </div>
                            )}
                            <div className="whitespace-pre-wrap text-sm leading-relaxed">{m.content}</div>
                        </div>
                    </div>
                ))}

                {realtimeTranscript && (
                    <div className="flex justify-start animate-[slideIn_180ms_ease-out]">
                        <div className="max-w-[85%] rounded-2xl rounded-bl-sm px-3 py-2 bg-gradient-to-r from-emerald-500/10 to-cyan-500/10 border shadow-sm">
                            <div className="text-[10px] uppercase tracking-wide opacity-60 mb-1 font-medium">
                                Live · gpt-realtime
                            </div>
                            <div className="whitespace-pre-wrap text-sm leading-relaxed">{realtimeTranscript}</div>
                        </div>
                    </div>
                )}

                {loading && (
                    <div className="flex justify-start">
                        <div className="bg-card border rounded-2xl rounded-bl-sm px-3 py-2 flex items-center gap-2 shadow-sm">
                            <span className="flex items-center gap-1">
                                <span className="w-1.5 h-1.5 bg-foreground/60 rounded-full animate-bounce [animation-delay:-0.3s]" />
                                <span className="w-1.5 h-1.5 bg-foreground/60 rounded-full animate-bounce [animation-delay:-0.15s]" />
                                <span className="w-1.5 h-1.5 bg-foreground/60 rounded-full animate-bounce" />
                            </span>
                            <span className="text-xs bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-amber-500 bg-clip-text text-transparent font-medium animate-pulse">
                                Thinking…
                            </span>
                        </div>
                    </div>
                )}
            </div>

            {error && (
                <div className="mx-3 mb-2 px-3 py-2 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-xs">
                    {error}
                </div>
            )}

            {/* Live-call launcher (shown when not already in a live session) */}
            {voiceSupported && realtimeStatus === 'idle' && (
                <div className="px-3 pt-2">
                    <button
                        type="button"
                        onClick={startLiveCall}
                        className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-emerald-500/30 bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-cyan-500/10 hover:from-emerald-500/15 hover:via-teal-500/15 hover:to-cyan-500/15 text-sm font-medium transition-colors"
                    >
                        <span className="relative flex h-2 w-2">
                            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                        </span>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                            <line x1="12" y1="19" x2="12" y2="23" />
                            <line x1="8" y1="23" x2="16" y2="23" />
                        </svg>
                        Talk live (gpt-realtime)
                    </button>
                </div>
            )}

            {/* Composer */}
            <form onSubmit={onSubmit} className="flex items-end gap-2 p-3 border-t bg-card">
                <div className="flex-1 relative">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder={listening ? 'Listening…' : transcribing ? 'Transcribing…' : 'Type a message…'}
                        disabled={loading || listening || transcribing}
                        className="w-full pl-3 pr-10 py-2.5 rounded-xl border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
                    />
                    {voiceSupported && (
                        <button
                            type="button"
                            onClick={listening ? stopListening : startListening}
                            disabled={loading || transcribing}
                            title={listening ? 'Stop & send' : 'Voice input'}
                            className={`absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg transition-all ${
                                listening
                                    ? 'bg-rose-500 text-white animate-pulse shadow-lg shadow-rose-500/30'
                                    : transcribing
                                        ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                                        : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                            }`}
                        >
                            {transcribing ? (
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
                                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                                </svg>
                            ) : (
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                                    <line x1="12" y1="19" x2="12" y2="23" />
                                    <line x1="8" y1="23" x2="16" y2="23" />
                                </svg>
                            )}
                        </button>
                    )}
                </div>
                <button
                    type="submit"
                    disabled={loading || !input.trim()}
                    className="px-4 py-2.5 rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-600 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-opacity shadow-md hover:shadow-lg"
                >
                    {loading ? '…' : 'Send'}
                </button>
            </form>
        </>
    )

    if (inline) {
        return (
            <div className="max-w-3xl mx-auto h-[calc(100dvh-8rem)] flex flex-col rounded-2xl border bg-card overflow-hidden shadow-sm">
                {panel}
            </div>
        )
    }

    return (
        <>
            <style jsx global>{`
                @keyframes slideIn {
                    from { opacity: 0; transform: translateY(6px); }
                    to   { opacity: 1; transform: translateY(0); }
                }
                @keyframes chatPop {
                    from { opacity: 0; transform: translateY(16px) scale(0.96); }
                    to   { opacity: 1; transform: translateY(0)    scale(1); }
                }
                @keyframes chatPulse {
                    0%, 100% { box-shadow: 0 4px 14px 0 rgba(99, 102, 241, 0.45), 0 0 0 0 rgba(217, 70, 239, 0.55); }
                    50%      { box-shadow: 0 4px 14px 0 rgba(99, 102, 241, 0.45), 0 0 0 14px rgba(217, 70, 239, 0); }
                }
            `}</style>

            {/* Floating launcher */}
            {!open && (
                <button
                    type="button"
                    onClick={() => setOpen(true)}
                    aria-label={`Open ${theme.accentBadge.toLowerCase()} assistant`}
                    className="fixed bottom-[calc(var(--app-bottom-offset,0px)+1.25rem)] right-5 z-50 group"
                    style={{ animation: 'chatPulse 2.4s ease-out infinite' }}
                >
                    <span className="flex items-center justify-center w-14 h-14 rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-600 text-white hover:scale-105 active:scale-95 transition-transform shadow-xl relative">
                        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.14 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z" fill="currentColor" stroke="none" />
                            <path d="M20 3v4M22 5h-4M4 17v2M5 18H3" />
                        </svg>
                        <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-emerald-400 rounded-full border-2 border-fuchsia-600" />
                    </span>
                </button>
            )}

            {/* Panel */}
            {mounted && (
                <div
                    className={`fixed bottom-[calc(var(--app-bottom-offset,0px)+1.25rem)] right-5 z-50 w-[min(92vw,400px)] h-[min(calc(100dvh-var(--app-bottom-offset,0px)-6rem),620px)] rounded-2xl border bg-card shadow-2xl overflow-hidden flex flex-col transition-all duration-200 ${
                        open ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-4 pointer-events-none'
                    }`}
                    style={open ? { animation: 'chatPop 220ms cubic-bezier(0.16, 1, 0.3, 1)' } : undefined}
                    onTransitionEnd={() => { if (!open) setMounted(false) }}
                >
                    {panel}
                </div>
            )}
        </>
    )
}
