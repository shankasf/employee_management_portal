'use client'

import { useEffect } from 'react'

// Registers /sw.js so the portal can be installed as an app. Production only:
// a service worker in `next dev` caches hot-reload chunks and gets confusing.
export default function RegisterServiceWorker() {
    useEffect(() => {
        if (process.env.NODE_ENV !== 'production') return
        if (!('serviceWorker' in navigator)) return
        navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => {
            console.warn('Service worker registration failed', err)
        })
    }, [])
    return null
}
