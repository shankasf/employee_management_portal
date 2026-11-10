import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { getTodayNY } from '@/lib/utils'

function createAdminClient() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
}

// GET /api/cron/birthday-notifications
// Daily job: for every active employee whose birthday is today (NY time), drop
// an in-app notification to the whole active team — and a "Happy Birthday" to
// the person themselves. Idempotent via dedupe_key, so re-running the same day
// is a no-op. No SMS/email (Twilio campaign scope is schedule/task/clock only).
export async function GET(request: NextRequest) {
    try {
        const cronSecret = process.env.CRON_SECRET
        if (!cronSecret) {
            console.error('[birthday-notifications] CRON_SECRET not configured')
            return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
        }
        if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const supabase = createAdminClient()
        const todayNY = getTodayNY()          // YYYY-MM-DD
        const todayMonthDay = todayNY.slice(5) // MM-DD

        // Active employees with a date of birth.
        const { data: employees, error: empErr } = await supabase
            .from('employees')
            .select('id, display_name, date_of_birth, is_active, profiles(full_name, status)')
            .eq('is_active', true)
            .not('date_of_birth', 'is', null)

        if (empErr) {
            console.error('[birthday-notifications] employees error:', empErr.message)
            return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const birthdayPeople = (employees as any[] || [])
            .filter((e) => e.profiles?.status !== 'inactive')
            .filter((e) => typeof e.date_of_birth === 'string' && e.date_of_birth.slice(5) === todayMonthDay)
            .map((e) => ({
                id: e.id as string,
                name: (e.display_name || e.profiles?.full_name || 'A teammate') as string,
            }))

        if (birthdayPeople.length === 0) {
            return NextResponse.json({ date: todayNY, birthdays: 0, notifications: 0 })
        }

        // All active recipients (employees + admins).
        const { data: recipients, error: recErr } = await supabase
            .from('profiles')
            .select('id, role')
            .eq('status', 'active')

        if (recErr) {
            console.error('[birthday-notifications] recipients error:', recErr.message)
            return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
        }

        const recipientList = (recipients || []).map((r) => ({
            id: r.id as string,
            role: (r.role as string | null) ?? 'employee',
        }))

        const rows: Array<{
            user_id: string
            type: string
            title: string
            body: string
            link: string
            dedupe_key: string
        }> = []

        for (const person of birthdayPeople) {
            const dedupe = `birthday:${person.id}:${todayNY}`
            for (const r of recipientList) {
                const isSelf = r.id === person.id
                rows.push({
                    user_id: r.id,
                    type: 'birthday',
                    title: isSelf ? '🎂 Happy Birthday!' : `🎂 It's ${person.name}'s birthday today!`,
                    body: isSelf
                        ? `Wishing you a wonderful birthday, ${person.name}!`
                        : `Take a moment to wish ${person.name} a happy birthday.`,
                    link: r.role === 'admin' ? '/admin/org-chart' : '/employee/org-chart',
                    dedupe_key: dedupe,
                })
            }
        }

        // Idempotent insert: existing (user_id, dedupe_key) rows are skipped.
        const { error: insErr } = await supabase
            .from('notifications')
            .upsert(rows, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true })

        if (insErr) {
            console.error('[birthday-notifications] insert error:', insErr.message)
            return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
        }

        console.log(`[birthday-notifications] ${birthdayPeople.length} birthday(s), ${rows.length} notifications on ${todayNY}`)
        return NextResponse.json({
            date: todayNY,
            birthdays: birthdayPeople.length,
            notifications: rows.length,
        })
    } catch (err) {
        console.error('[birthday-notifications] Unexpected error:', err)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
