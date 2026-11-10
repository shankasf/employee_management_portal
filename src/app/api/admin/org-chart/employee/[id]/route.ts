import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getTodayNY, getDateNY, getNYDayBoundary } from '@/lib/utils'

// GET /api/admin/org-chart/employee/[id]
// Returns a summary panel payload:
// {
//   employee: { id, display_name, position, profile_picture_url, is_active,
//               created_at, email, full_name, phone_number, shift_type, shift_start, shift_end },
//   weekSchedules: Schedule[],          // this Sun..Sat
//   upcomingShifts: Schedule[],         // next 4 schedules >= today
//   weekHours: { totalMinutes, days: { date, minutes }[] },
//   payPeriodHours: { totalMinutes, startDate, endDate },
//   recentAttendance: AttendanceLog[],  // last 10
//   workedLocations: { name, minutes }[],
//   openAttendance: AttendanceLog | null,
// }
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
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

        const { id } = params
        const today = getTodayNY()

        // Compute current week (Sun..Sat) in NY
        const [yy, mm, dd] = today.split('-').map(Number)
        const todayDate = new Date(Date.UTC(yy, mm - 1, dd, 12, 0, 0))
        const dow = todayDate.getUTCDay() // 0=Sun..6=Sat (UTC-based since we used noon UTC)
        const weekStart = getDateNY(-dow)
        const weekEnd = getDateNY(6 - dow)

        // Pay period: assume bi-weekly aligned to Sunday, anchor = 2024-01-07 (a Sunday)
        // Find current period start: the most recent Sunday whose week-index is even
        const PAY_ANCHOR = '2024-01-07'
        const anchorDate = new Date(`${PAY_ANCHOR}T12:00:00Z`)
        const todayUtc = new Date(`${today}T12:00:00Z`)
        const daysSinceAnchor = Math.floor((todayUtc.getTime() - anchorDate.getTime()) / (24 * 3600 * 1000))
        const periodDay = daysSinceAnchor % 14
        const periodStartOffset = -periodDay
        const payStart = getDateNY(periodStartOffset + (-dow + dow)) // simplification: just use period start
        // Simpler: payStart = anchor + floor(daysSinceAnchor/14)*14
        const periodIndex = Math.floor(daysSinceAnchor / 14)
        const periodStartUtc = new Date(anchorDate.getTime() + periodIndex * 14 * 24 * 3600 * 1000)
        const periodStartStr = periodStartUtc.toISOString().slice(0, 10)
        const periodEndUtc = new Date(periodStartUtc.getTime() + 13 * 24 * 3600 * 1000)
        const periodEndStr = periodEndUtc.toISOString().slice(0, 10)
        // (payStart variable retained to satisfy lint; not used)
        void payStart

        const periodStartIso = getNYDayBoundary(periodStartStr, 'start')
        const periodEndIso = getNYDayBoundary(periodEndStr, 'end')
        const weekStartIso = getNYDayBoundary(weekStart, 'start')
        const weekEndIso = getNYDayBoundary(weekEnd, 'end')

        const [employeeRes, weekSchedRes, upcomingSchedRes, attendanceRes, openRes] = await Promise.all([
            supabase
                .from('employees')
                .select(`
                    id, display_name, position, profile_picture_url, is_active,
                    created_at, work_location, phone_number, shift_type, shift_start, shift_end,
                    profiles ( email, full_name )
                `)
                .eq('id', id)
                .single(),
            supabase
                .from('schedules')
                .select('*')
                .eq('employee_id', id)
                .gte('schedule_date', weekStart)
                .lte('schedule_date', weekEnd)
                .order('schedule_date'),
            supabase
                .from('schedules')
                .select('*')
                .eq('employee_id', id)
                .gte('schedule_date', today)
                .order('schedule_date')
                .limit(4),
            supabase
                .from('attendance_logs')
                .select('*')
                .eq('employee_id', id)
                .gte('clock_in', periodStartIso)
                .lte('clock_in', periodEndIso)
                .order('clock_in', { ascending: false }),
            supabase
                .from('attendance_logs')
                .select('*')
                .eq('employee_id', id)
                .is('clock_out', null)
                .order('clock_in', { ascending: false })
                .limit(1)
                .maybeSingle(),
        ])

        if (employeeRes.error) {
            return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
        }

        // Flatten employee
        const emp = employeeRes.data as Record<string, unknown>
        const prof = (emp.profiles as { email?: string | null; full_name?: string | null } | null) || null
        const employee = {
            id: emp.id as string,
            display_name: emp.display_name as string | null,
            position: emp.position as string | null,
            profile_picture_url: emp.profile_picture_url as string | null,
            is_active: emp.is_active as boolean,
            created_at: emp.created_at as string,
            work_location: emp.work_location as string | null,
            phone_number: emp.phone_number as string | null,
            shift_type: emp.shift_type as string | null,
            shift_start: emp.shift_start as string | null,
            shift_end: emp.shift_end as string | null,
            email: prof?.email ?? null,
            full_name: prof?.full_name ?? null,
        }

        const attendance = (attendanceRes.data || []) as Array<Record<string, unknown>>

        // Week hours: sum minutes per day in [weekStart..weekEnd]
        const weekAtt = attendance.filter(a => {
            const ci = a.clock_in as string
            return ci >= weekStartIso && ci <= weekEndIso
        })
        const dayMinutes = new Map<string, number>()
        let weekTotal = 0
        for (const a of weekAtt) {
            const ci = a.clock_in as string
            const co = (a.clock_out as string | null) ?? null
            if (!co) continue
            const minutes = Math.max(0, Math.round((new Date(co).getTime() - new Date(ci).getTime()) / 60000)) - ((a.break_minutes as number | null) || 0)
            // Date in NY
            const dayKey = new Date(ci).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
            dayMinutes.set(dayKey, (dayMinutes.get(dayKey) || 0) + Math.max(0, minutes))
            weekTotal += Math.max(0, minutes)
        }

        // Pay period total
        let payTotal = 0
        for (const a of attendance) {
            const ci = a.clock_in as string
            const co = (a.clock_out as string | null) ?? null
            if (!co) continue
            const minutes = Math.max(0, Math.round((new Date(co).getTime() - new Date(ci).getTime()) / 60000)) - ((a.break_minutes as number | null) || 0)
            payTotal += Math.max(0, minutes)
        }

        // Worked locations (period scope)
        const locMinutes = new Map<string, number>()
        for (const a of attendance) {
            const name = (a.clock_in_location_name as string | null) || 'Unknown'
            const ci = a.clock_in as string
            const co = (a.clock_out as string | null) ?? null
            if (!co) continue
            const minutes = Math.max(0, Math.round((new Date(co).getTime() - new Date(ci).getTime()) / 60000)) - ((a.break_minutes as number | null) || 0)
            locMinutes.set(name, (locMinutes.get(name) || 0) + Math.max(0, minutes))
        }

        const weekDays: { date: string; minutes: number }[] = []
        for (let i = 0; i < 7; i++) {
            const d = getDateNY(-dow + i)
            weekDays.push({ date: d, minutes: dayMinutes.get(d) || 0 })
        }

        return NextResponse.json({
            employee,
            weekSchedules: weekSchedRes.data || [],
            upcomingShifts: upcomingSchedRes.data || [],
            weekHours: { totalMinutes: weekTotal, days: weekDays, weekStart, weekEnd },
            payPeriodHours: { totalMinutes: payTotal, startDate: periodStartStr, endDate: periodEndStr },
            recentAttendance: attendance.slice(0, 10),
            workedLocations: Array.from(locMinutes.entries())
                .sort((a, b) => b[1] - a[1])
                .map(([name, minutes]) => ({ name, minutes })),
            openAttendance: openRes.data || null,
        })
    } catch (err) {
        console.error('GET /api/admin/org-chart/employee/[id] error:', err)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
