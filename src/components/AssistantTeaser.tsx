'use client'

import { useEffect, useState } from 'react'

const PROMPTS = [
    'Which employees have completed onboarding?',
    "Who's clocked in right now?",
    'Show me overdue tasks for this week',
    "Did Maria finish today's tasks?",
    "Who's working tomorrow?",
    "Employees who haven't completed onboarding",
    'How many hours did John work last week?',
    'Any pending shift cancellation requests?',
]

const TYPE_MS = 38
const ERASE_MS = 18
const HOLD_MS = 1500

function useTypewriter() {
    const [text, setText] = useState('')
    const [idx, setIdx] = useState(0)
    const [phase, setPhase] = useState<'typing' | 'holding' | 'erasing'>('typing')

    useEffect(() => {
        const target = PROMPTS[idx % PROMPTS.length]
        let timer: ReturnType<typeof setTimeout>
        if (phase === 'typing') {
            if (text.length < target.length) {
                timer = setTimeout(() => setText(target.slice(0, text.length + 1)), TYPE_MS)
            } else {
                timer = setTimeout(() => setPhase('holding'), 0)
            }
        } else if (phase === 'holding') {
            timer = setTimeout(() => setPhase('erasing'), HOLD_MS)
        } else {
            if (text.length > 0) {
                timer = setTimeout(() => setText(target.slice(0, text.length - 1)), ERASE_MS)
            } else {
                setIdx((i) => (i + 1) % PROMPTS.length)
                setPhase('typing')
            }
        }
        return () => clearTimeout(timer)
    }, [text, phase, idx])

    return text
}

export default function AssistantTeaser() {
    const text = useTypewriter()

    const focusFloatingChatbot = () => {
        // The floating widget is in the same DOM tree (admin layout). Click event
        // bubbles to the launcher button via aria-label match.
        const btn = document.querySelector<HTMLButtonElement>(
            'button[aria-label="Open admin assistant"]',
        )
        if (btn) {
            btn.click()
        } else {
            // Fallback: navigate to the full-page route.
            window.location.href = '/admin/assistant'
        }
    }

    return (
        <button
            type="button"
            onClick={focusFloatingChatbot}
            className="w-full text-left rounded-2xl border bg-gradient-to-r from-indigo-500/10 via-fuchsia-500/10 to-amber-500/10 hover:from-indigo-500/15 hover:via-fuchsia-500/15 hover:to-amber-500/15 transition-colors p-4 sm:p-5 group"
        >
            <div className="flex items-center gap-3 sm:gap-4">
                <div className="relative flex-shrink-0">
                    <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center text-2xl shadow-md group-hover:scale-105 transition-transform">
                        🤖
                    </div>
                    <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-400 rounded-full border-2 border-background animate-pulse" />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="text-xs sm:text-sm font-medium text-muted-foreground mb-1">
                        Admin Assistant — try asking
                    </div>
                    <div className="font-semibold text-base sm:text-lg truncate">
                        {text || ' '}
                        <span className="inline-block w-[2px] h-4 sm:h-5 bg-primary ml-0.5 animate-pulse align-middle" />
                    </div>
                </div>
                <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                    Ask
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="5" y1="12" x2="19" y2="12" />
                        <polyline points="12 5 19 12 12 19" />
                    </svg>
                </div>
            </div>
        </button>
    )
}
