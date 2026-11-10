'use client'

// Browser-side helpers for push reminders. Server counterpart: src/lib/push.ts.

export type PushStatus =
    | 'loading'
    | 'unsupported'      // browser has no Push API at all
    | 'needs-install'    // iOS Safari: push only works from the Home Screen app
    | 'prompt'           // supported, permission not asked yet
    | 'denied'           // user blocked notifications for this site
    | 'subscribed'       // permission granted and subscription saved

export function isStandaloneDisplay(): boolean {
    if (typeof window === 'undefined') return false
    return (
        window.matchMedia('(display-mode: standalone)').matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true
    )
}

export function isIosDevice(): boolean {
    if (typeof navigator === 'undefined') return false
    const ua = navigator.userAgent
    return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1)
}

export function pushSupported(): boolean {
    return typeof window !== 'undefined'
        && 'serviceWorker' in navigator
        && 'PushManager' in window
        && 'Notification' in window
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
    const padding = '='.repeat((4 - (base64.length % 4)) % 4)
    const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
    const raw = atob(b64)
    const out = new Uint8Array(new ArrayBuffer(raw.length))
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
    return out
}

async function readyRegistration(timeoutMs = 8000): Promise<ServiceWorkerRegistration | null> {
    if (!('serviceWorker' in navigator)) return null
    // navigator.serviceWorker.ready never settles if nothing was registered
    // (dev mode), so cap the wait.
    return Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ])
}

/** Current state without prompting the user. */
export async function getPushStatus(): Promise<PushStatus> {
    if (!pushSupported()) {
        return isIosDevice() && !isStandaloneDisplay() ? 'needs-install' : 'unsupported'
    }
    if (Notification.permission === 'denied') return 'denied'
    if (Notification.permission === 'default') return 'prompt'
    const reg = await readyRegistration()
    if (!reg) return 'prompt'
    const sub = await reg.pushManager.getSubscription()
    return sub ? 'subscribed' : 'prompt'
}

async function saveSubscription(sub: PushSubscription): Promise<void> {
    const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ subscription: sub.toJSON() }),
    })
    if (!res.ok) throw new Error(`Failed to save subscription (${res.status})`)
}

/**
 * Ask for permission and subscribe. Must be called from a user gesture
 * (button tap) or Safari/iOS silently refuses.
 */
export async function enablePush(): Promise<PushStatus> {
    if (!pushSupported()) {
        return isIosDevice() && !isStandaloneDisplay() ? 'needs-install' : 'unsupported'
    }
    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    if (!vapidKey) throw new Error('Push is not configured on the server')

    const permission = await Notification.requestPermission()
    if (permission === 'denied') return 'denied'
    if (permission !== 'granted') return 'prompt'

    const reg = await readyRegistration()
    if (!reg) throw new Error('Service worker not ready')

    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
        sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidKey),
        })
    }
    await saveSubscription(sub)
    return 'subscribed'
}

/**
 * Re-send an existing subscription to the server (e.g. after a new login on
 * the same device, so the row is tied to the right user). No prompt.
 */
export async function syncExistingSubscription(): Promise<void> {
    if (!pushSupported() || Notification.permission !== 'granted') return
    const reg = await readyRegistration()
    if (!reg) return
    const sub = await reg.pushManager.getSubscription()
    if (sub) await saveSubscription(sub).catch(() => {})
}

export async function disablePush(): Promise<void> {
    if (!pushSupported()) return
    const reg = await readyRegistration()
    if (!reg) return
    const sub = await reg.pushManager.getSubscription()
    if (!sub) return
    await fetch('/api/push/subscribe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => {})
    await sub.unsubscribe()
}
