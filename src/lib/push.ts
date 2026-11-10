import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'

// Browser push (Web Push / VAPID). Free: messages go through the browser
// vendor's push service (Google, Mozilla, Apple), not Twilio.
//
// Server-only. Reads push_subscriptions with the service role; the employee
// portal writes rows through /api/push/subscribe.

export interface PushPayload {
    title: string
    body: string
    /** In-app path to open when the notification is tapped. */
    url?: string
    /** Same tag replaces an earlier notification instead of stacking. */
    tag?: string
    /** Keep the notification on screen until dismissed (Android/desktop). */
    requireInteraction?: boolean
}

export interface PushResult {
    /** Subscriptions we attempted. */
    attempted: number
    /** Subscriptions the push service accepted (2xx). */
    sent: number
    /** Subscriptions removed because the push service said they are gone (404/410). */
    removed: number
    errors: string[]
}

let configured = false

function ensureConfigured(): boolean {
    if (configured) return true
    const publicKey = process.env.VAPID_PUBLIC_KEY
    const privateKey = process.env.VAPID_PRIVATE_KEY
    const subject = process.env.VAPID_SUBJECT || 'mailto:noreply@playfunia.com'
    if (!publicKey || !privateKey) {
        console.warn('[push] VAPID keys not configured; push disabled')
        return false
    }
    webpush.setVapidDetails(subject, publicKey, privateKey)
    configured = true
    return true
}

export function isPushConfigured(): boolean {
    return ensureConfigured()
}

function adminClient() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } }
    )
}

interface SubscriptionRow {
    id: string
    user_id: string
    endpoint: string
    p256dh: string
    auth: string
}

/**
 * Which of these users have at least one push subscription. Used by the
 * reminder cron to decide whether an SMS fallback is still needed.
 */
export async function getUsersWithPush(userIds: string[]): Promise<Set<string>> {
    const result = new Set<string>()
    if (userIds.length === 0) return result
    const { data, error } = await adminClient()
        .from('push_subscriptions')
        .select('user_id')
        .in('user_id', userIds)
    if (error) {
        console.error('[push] getUsersWithPush error:', error.message)
        return result
    }
    for (const row of (data || []) as { user_id: string }[]) result.add(row.user_id)
    return result
}

/**
 * Send one payload to every subscription of the given users. Dead
 * subscriptions (push service answers 404/410) are deleted so we stop
 * retrying them.
 */
export async function sendPushToUsers(userIds: string[], payload: PushPayload): Promise<PushResult> {
    const result: PushResult = { attempted: 0, sent: 0, removed: 0, errors: [] }
    if (userIds.length === 0) return result
    if (!ensureConfigured()) {
        result.errors.push('VAPID not configured')
        return result
    }

    const supabase = adminClient()
    const { data, error } = await supabase
        .from('push_subscriptions')
        .select('id, user_id, endpoint, p256dh, auth')
        .in('user_id', userIds)
    if (error) {
        result.errors.push(error.message)
        return result
    }

    const subs = (data || []) as SubscriptionRow[]
    result.attempted = subs.length
    const body = JSON.stringify(payload)
    const now = new Date().toISOString()

    await Promise.all(subs.map(async (sub) => {
        try {
            await webpush.sendNotification(
                { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                body,
                { TTL: 60 * 60, urgency: 'high' }
            )
            result.sent++
            await supabase
                .from('push_subscriptions')
                .update({ last_success_at: now, last_error: null })
                .eq('id', sub.id)
        } catch (err) {
            const statusCode = (err as { statusCode?: number })?.statusCode
            const message = err instanceof Error ? err.message : String(err)
            if (statusCode === 404 || statusCode === 410) {
                await supabase.from('push_subscriptions').delete().eq('id', sub.id)
                result.removed++
            } else {
                result.errors.push(`${sub.id}: ${statusCode ?? ''} ${message}`.trim())
                await supabase
                    .from('push_subscriptions')
                    .update({ last_error: `${statusCode ?? ''} ${message}`.trim().slice(0, 500) })
                    .eq('id', sub.id)
            }
        }
    }))

    return result
}

export async function sendPushToUser(userId: string, payload: PushPayload): Promise<PushResult> {
    return sendPushToUsers([userId], payload)
}
