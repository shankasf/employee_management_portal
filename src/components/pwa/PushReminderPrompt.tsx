'use client'

import { useCallback, useEffect, useState } from 'react'
import { enablePush, getPushStatus, syncExistingSubscription, type PushStatus } from '@/lib/push-client'

// "Turn on shift reminders" card for the employee dashboard.
//
// States:
//  - prompt        : big button; permission + subscribe happen inside the tap
//                    (iOS requires a user gesture).
//  - needs-install : iOS Safari tab. Push only works from the Home Screen app,
//                    so show the Share -> Add to Home Screen steps.
//  - denied        : notifications blocked in browser settings; explain how to
//                    re-enable.
//  - subscribed    : render nothing here (the Time Clock card shows a pill).
//  - unsupported   : render nothing.

const DISMISS_KEY = 'playfunia_push_prompt_dismissed_at'
const DISMISS_DAYS = 7

function recentlyDismissed() {
    try {
        const at = Number(localStorage.getItem(DISMISS_KEY) || 0)
        return Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000
    } catch {
        return false
    }
}

interface Props {
    onStatusChange?: (status: PushStatus) => void
}

export default function PushReminderPrompt({ onStatusChange }: Props) {
    const [status, setStatus] = useState<PushStatus>('loading')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [dismissed, setDismissed] = useState(true)

    const update = useCallback((s: PushStatus) => {
        setStatus(s)
        onStatusChange?.(s)
    }, [onStatusChange])

    useEffect(() => {
        let cancelled = false
        setDismissed(recentlyDismissed())
        getPushStatus().then((s) => {
            if (cancelled) return
            update(s)
            // Already granted on this device: make sure the server row belongs
            // to whoever is logged in now.
            if (s === 'subscribed') syncExistingSubscription()
        })
        return () => { cancelled = true }
    }, [update])

    const enable = async () => {
        setBusy(true)
        setError(null)
        try {
            const s = await enablePush()
            update(s)
            if (s === 'prompt') setError('Permission was not granted. Tap again to retry.')
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not turn on reminders')
        } finally {
            setBusy(false)
        }
    }

    const dismiss = () => {
        try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch { /* private mode */ }
        setDismissed(true)
    }

    if (status === 'loading' || status === 'subscribed' || status === 'unsupported') return null
    if (dismissed) return null

    return (
        <div
            data-testid="push-reminder-prompt"
            data-status={status}
            className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-4 dark:border-amber-900 dark:from-amber-950/50 dark:to-orange-950/30"
        >
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white shadow-md">
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
            </div>
            <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-amber-950 dark:text-amber-100">Never miss a punch</p>
                {status === 'prompt' && (
                    <>
                        <p className="mt-0.5 text-xs leading-relaxed text-amber-900/80 dark:text-amber-200/80">
                            Get a reminder on this device when your shift starts, when it ends, and when your 30-minute lunch is up. No text messages needed.
                        </p>
                        <button
                            type="button"
                            onClick={enable}
                            disabled={busy}
                            className="mt-3 inline-flex h-11 items-center gap-2 rounded-xl bg-amber-500 px-4 text-sm font-semibold text-white shadow-[0_6px_16px_-4px_rgba(245,158,11,0.5)] active:scale-[0.98] disabled:opacity-60"
                        >
                            {busy ? 'Turning on…' : 'Turn on reminders'}
                        </button>
                    </>
                )}
                {status === 'needs-install' && (
                    <p className="mt-0.5 text-xs leading-relaxed text-amber-900/80 dark:text-amber-200/80">
                        On iPhone, reminders only work from the Home Screen app. Tap{' '}
                        <svg aria-label="Share" className="inline -mt-0.5 h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><polyline points="16 6 12 2 8 6" /><line x1="12" y1="2" x2="12" y2="15" /></svg>{' '}
                        <strong>Share</strong>, then <strong>Add to Home Screen</strong>, and open PlayFunia from that icon.
                    </p>
                )}
                {status === 'denied' && (
                    <p className="mt-0.5 text-xs leading-relaxed text-amber-900/80 dark:text-amber-200/80">
                        Notifications are blocked for this site. Open your browser or phone settings, allow notifications for PlayFunia, then come back here.
                    </p>
                )}
                {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
            </div>
            <button type="button" onClick={dismiss} aria-label="Dismiss" className="-m-1 flex h-9 w-9 items-center justify-center rounded-full text-amber-900/60 hover:bg-white/60 dark:text-amber-200/60 dark:hover:bg-white/10">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
        </div>
    )
}
