import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

// Browser push subscriptions for shift / lunch reminders.
//
// POST   { subscription: PushSubscriptionJSON }  -> save (upsert by endpoint)
// DELETE { endpoint }                            -> remove
//
// The row is tied to the signed-in user; the reminder cron reads it with the
// service role. Endpoints are unique, so re-subscribing from the same browser
// just refreshes the keys.

interface SubscriptionJSON {
    endpoint?: string
    keys?: { p256dh?: string; auth?: string }
}

function validSubscription(sub: unknown): sub is Required<SubscriptionJSON> & { keys: { p256dh: string; auth: string } } {
    if (!sub || typeof sub !== 'object') return false
    const s = sub as SubscriptionJSON
    return typeof s.endpoint === 'string'
        && s.endpoint.startsWith('https://')
        && s.endpoint.length < 2048
        && typeof s.keys?.p256dh === 'string'
        && typeof s.keys?.auth === 'string'
}

export async function POST(request: Request) {
    const auth = await createClient()
    const { data: { user } } = await auth.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    let body: { subscription?: unknown } = {}
    try {
        body = await request.json()
    } catch {
        return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }
    if (!validSubscription(body.subscription)) {
        return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 })
    }
    const sub = body.subscription

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = (await createServiceClient()) as any
    const { error } = await supabase
        .from('push_subscriptions')
        .upsert(
            {
                user_id: user.id,
                endpoint: sub.endpoint,
                p256dh: sub.keys.p256dh,
                auth: sub.keys.auth,
                user_agent: (request.headers.get('user-agent') || '').slice(0, 300),
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'endpoint' }
        )

    if (error) {
        console.error('[push/subscribe] upsert', error)
        return NextResponse.json({ error: 'Failed to save subscription' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
}

export async function DELETE(request: Request) {
    const auth = await createClient()
    const { data: { user } } = await auth.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    let body: { endpoint?: unknown } = {}
    try {
        body = await request.json()
    } catch {
        return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }
    if (typeof body.endpoint !== 'string') {
        return NextResponse.json({ error: 'endpoint required' }, { status: 400 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = (await createServiceClient()) as any
    const { error } = await supabase
        .from('push_subscriptions')
        .delete()
        .eq('endpoint', body.endpoint)
        .eq('user_id', user.id)

    if (error) {
        console.error('[push/subscribe] delete', error)
        return NextResponse.json({ error: 'Failed to remove subscription' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
}
