import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getTodayNY } from '@/lib/utils'

// GET /api/admin/org-chart/live-status
// Returns a per-employee live snapshot used by the org-chart hover tooltips:
// { liveStatus: { [employeeId]: { openClockIn: string | null,
//                                 todayShift: { start_time, end_time, location } | null,
//                                 weekMinutes: number } } }
export async function GET() {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single()
        if ((profile as { role?: string } | null)?.role !== 'admin') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        const today = getTodayNY()

        // Compute current week (Sun..Sat) in NY
        const [yy, mm, dd] = today.split('-').map(Number)
        const todayDate = new Date(Date.UTC(yy, mm - 1, dd, 12, 0, 0))
        const dow = todayDate.getUTCDay()
        const weekStartDate = new Date(todayDate.getTime() - dow * 24 * 3600 * 1000)
        const weekStartStr = weekStartDate.toISOString().slice(0, 10)
        // Use NY day boundary for clock_in filter: from week start 00:00 NY
        const weekStartIso = new Date(`${weekStartStr}T00:00:00-05:00`).toISOString()

        const [openRes, todayRes, weekRes] = await Promise.all([
            supabase
                .from('attendance_logs')
                .select('employee_id, clock_in')
                .is('clock_out', null),
            supabase
                .from('schedules')
                .select('employee_id, start_time, end_time, location')
                .eq('schedule_date', today),
            supabase
                .from('attendance_logs')
                .select('employee_id, clock_in, clock_out, break_minutes')
                .gte('clock_in', weekStartIso)
                .not('clock_out', 'is', null),
        ])

        if (openRes.error || todayRes.error || weekRes.error) {
            return NextResponse.json({ error: 'Failed to load live status' }, { status: 500 })
        }

        const result: Record<string, { openClockIn: string | null; todayShift: { start_time: string; end_time: string; location: string | null } | null; weekMinutes: number }> = {}

        for (const row of (openRes.data || []) as Array<{ employee_id: string; clock_in: string }>) {
            if (!result[row.employee_id]) {
                result[row.employee_id] = { openClockIn: null, todayShift: null, weekMinutes: 0 }
            }
            // First clock-in wins (most recent if multiple, though unusual)
            if (!result[row.employee_id].openClockIn || result[row.employee_id].openClockIn! < row.clock_in) {
                result[row.employee_id].openClockIn = row.clock_in
            }
        }

        for (const row of (todayRes.data || []) as Array<{ employee_id: string; start_time: string; end_time: string; location: string | null }>) {
            if (!result[row.employee_id]) {
                result[row.employee_id] = { openClockIn: null, todayShift: null, weekMinutes: 0 }
            }
            // Pick earliest start time if multiple shifts in one day
            if (!result[row.employee_id].todayShift || result[row.employee_id].todayShift!.start_time > row.start_time) {
                result[row.employee_id].todayShift = {
                    start_time: row.start_time,
                    end_time: row.end_time,
                    location: row.location,
                }
            }
        }

        for (const row of (weekRes.data || []) as Array<{ employee_id: string; clock_in: string; clock_out: string; break_minutes: number | null }>) {
            const minutes = Math.max(0, Math.round((new Date(row.clock_out).getTime() - new Date(row.clock_in).getTime()) / 60000)) - (row.break_minutes || 0)
            if (!result[row.employee_id]) {
                result[row.employee_id] = { openClockIn: null, todayShift: null, weekMinutes: 0 }
            }
            result[row.employee_id].weekMinutes += Math.max(0, minutes)
        }

        return NextResponse.json({ liveStatus: result })
    } catch (err) {
        console.error('GET /api/admin/org-chart/live-status error:', err)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
