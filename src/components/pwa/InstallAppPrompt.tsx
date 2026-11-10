'use client'

import { useEffect, useState } from 'react'

// Nudges employees to add the portal to their home screen.
// Android/Chrome: uses the native install prompt. iOS Safari has no install API,
// so we show the Share → "Add to Home Screen" steps instead.

interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'playfunia_install_dismissed_at'
const DISMISS_DAYS = 14

function isStandalone() {
    return (
        window.matchMedia('(display-mode: standalone)').matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true
    )
}

function recentlyDismissed() {
    try {
        const at = Number(localStorage.getItem(DISMISS_KEY) || 0)
        return Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000
    } catch {
        return false
    }
}

export default function InstallAppPrompt() {
    const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
    const [showIos, setShowIos] = useState(false)
    const [visible, setVisible] = useState(false)

    useEffect(() => {
        if (isStandalone() || recentlyDismissed()) return

        const ua = navigator.userAgent
        const isIos = /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1)
        const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)
        if (isIos && isSafari) {
            setShowIos(true)
            setVisible(true)
            return
        }

        const onPrompt = (e: Event) => {
            e.preventDefault()
            setDeferred(e as BeforeInstallPromptEvent)
            setVisible(true)
        }
        const onInstalled = () => setVisible(false)
        window.addEventListener('beforeinstallprompt', onPrompt)
        window.addEventListener('appinstalled', onInstalled)
        return () => {
            window.removeEventListener('beforeinstallprompt', onPrompt)
            window.removeEventListener('appinstalled', onInstalled)
        }
    }, [])

    const dismiss = () => {
        try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch { /* private mode */ }
        setVisible(false)
    }

    const install = async () => {
        if (!deferred) return
        await deferred.prompt()
        await deferred.userChoice
        setDeferred(null)
        setVisible(false)
    }

    if (!visible) return null

    return (
        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-purple-50 p-4 dark:border-indigo-900 dark:from-indigo-950/60 dark:to-purple-950/40">
            <img src="/icons/icon-192.png" alt="" className="h-11 w-11 flex-shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm text-indigo-950 dark:text-indigo-100">Get the PlayFunia app</p>
                {showIos ? (
                    <p className="mt-0.5 text-xs leading-relaxed text-indigo-900/80 dark:text-indigo-200/80">
                        Tap{' '}
                        <svg aria-label="Share" className="inline -mt-0.5 h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><polyline points="16 6 12 2 8 6" /><line x1="12" y1="2" x2="12" y2="15" /></svg>{' '}
                        <strong>Share</strong>, then <strong>Add to Home Screen</strong>.
                    </p>
                ) : (
                    <p className="mt-0.5 text-xs leading-relaxed text-indigo-900/80 dark:text-indigo-200/80">
                        Open it from your home screen. No browser, no typing the address.
                    </p>
                )}
                {!showIos && (
                    <button type="button" onClick={install} className="mt-3 inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground active:scale-[0.98]">
                        Install app
                    </button>
                )}
            </div>
            <button type="button" onClick={dismiss} aria-label="Dismiss" className="-m-1 flex h-9 w-9 items-center justify-center rounded-full text-indigo-900/60 hover:bg-white/60 dark:text-indigo-200/60 dark:hover:bg-white/10">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
        </div>
    )
}
