'use client'

import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { getRelativeTime } from '@/lib/utils'

export type NotificationItem = {
    id: string
    type: string
    title: string
    body: string | null
    link: string | null
    is_read: boolean
    created_at: string
}

type Payload = { notifications: NotificationItem[]; unreadCount: number }

const fetcher = (url: string): Promise<Payload> =>
    fetch(url, { credentials: 'include' }).then((r) => {
        if (!r.ok) throw new Error('Failed to load notifications')
        return r.json()
    })

export const NOTIFICATIONS_KEY = '/api/notifications'

async function markRead(payload: { id?: string; all?: boolean }) {
    await fetch(NOTIFICATIONS_KEY, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    })
}

export default function NotificationsList() {
    const router = useRouter()
    const { data, error, isLoading, mutate } = useSWR<Payload>(NOTIFICATIONS_KEY, fetcher, {
        refreshInterval: 60_000,
        revalidateOnFocus: true,
    })

    const notifications = data?.notifications || []
    const unreadCount = data?.unreadCount || 0

    const handleClick = async (n: NotificationItem) => {
        if (!n.is_read) {
            // Optimistically flip read state.
            mutate(
                (prev) =>
                    prev
                        ? {
                              notifications: prev.notifications.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)),
                              unreadCount: Math.max(0, prev.unreadCount - 1),
                          }
                        : prev,
                false
            )
            await markRead({ id: n.id })
            mutate()
        }
        if (n.link) router.push(n.link)
    }

    const handleMarkAll = async () => {
        mutate(
            (prev) => (prev ? { notifications: prev.notifications.map((x) => ({ ...x, is_read: true })), unreadCount: 0 } : prev),
            false
        )
        await markRead({ all: true })
        mutate()
    }

    return (
        <div className="space-y-4 max-w-2xl">
            <div className="flex items-center justify-between gap-2">
                <div>
                    <h1 className="text-2xl font-bold">Notifications</h1>
                    <p className="text-sm text-muted-foreground">
                        {unreadCount > 0 ? `${unreadCount} unread` : 'You’re all caught up.'}
                    </p>
                </div>
                {unreadCount > 0 && (
                    <button type="button" onClick={handleMarkAll} className="btn-outline btn-sm">
                        Mark all read
                    </button>
                )}
            </div>

            {isLoading ? (
                <div className="flex items-center justify-center py-16">
                    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary" />
                </div>
            ) : error ? (
                <p className="text-destructive">Failed to load notifications.</p>
            ) : notifications.length === 0 ? (
                <div className="bg-card border rounded-lg p-10 text-center text-muted-foreground">
                    <p className="text-4xl mb-2">🔔</p>
                    <p>No notifications yet.</p>
                </div>
            ) : (
                <ul className="space-y-2">
                    {notifications.map((n) => (
                        <li key={n.id}>
                            <button
                                type="button"
                                onClick={() => handleClick(n)}
                                className={`w-full text-left flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-accent ${
                                    n.is_read ? 'bg-card' : 'bg-primary/5 border-primary/30'
                                }`}
                            >
                                {!n.is_read && <span className="mt-1.5 w-2 h-2 rounded-full bg-primary flex-shrink-0" aria-label="Unread" />}
                                <div className={`flex-1 min-w-0 ${n.is_read ? 'pl-5' : ''}`}>
                                    <p className={`text-sm ${n.is_read ? 'font-medium' : 'font-semibold'}`}>{n.title}</p>
                                    {n.body && <p className="text-sm text-muted-foreground mt-0.5 break-words">{n.body}</p>}
                                    <p className="text-xs text-muted-foreground mt-1">{getRelativeTime(n.created_at)}</p>
                                </div>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}
