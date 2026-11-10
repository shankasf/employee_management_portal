import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/notifications
// Returns the current user's notifications (most recent 50) and unread count.
// RLS restricts rows to the authenticated recipient.
export async function GET() {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const [listRes, unreadRes] = await Promise.all([
            supabase
                .from('notifications')
                .select('id, type, title, body, link, is_read, created_at')
                .eq('user_id', user.id)
                .order('created_at', { ascending: false })
                .limit(50),
            supabase
                .from('notifications')
                .select('id', { count: 'exact', head: true })
                .eq('user_id', user.id)
                .eq('is_read', false),
        ])

        if (listRes.error) throw listRes.error

        return NextResponse.json({
            notifications: listRes.data || [],
            unreadCount: unreadRes.count ?? 0,
        })
    } catch (err) {
        console.error('GET /api/notifications error:', err)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}

// POST /api/notifications  { id?: string, all?: boolean }
// Marks a single notification read, or all of the user's notifications read.
export async function POST(request: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const body = await request.json().catch(() => ({})) as { id?: string; all?: boolean }

        if (body.all) {
            const { error } = await supabase
                .from('notifications')
                .update({ is_read: true } as never)
                .eq('user_id', user.id)
                .eq('is_read', false)
            if (error) throw error
        } else {
            if (!body.id || typeof body.id !== 'string') {
                return NextResponse.json({ error: 'id or all is required' }, { status: 400 })
            }
            const { error } = await supabase
                .from('notifications')
                .update({ is_read: true } as never)
                .eq('user_id', user.id)
                .eq('id', body.id)
            if (error) throw error
        }

        return NextResponse.json({ success: true })
    } catch (err) {
        console.error('POST /api/notifications error:', err)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
