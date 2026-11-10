import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { logActivity, getRequestInfo } from '@/lib/activity-log'
import { getAdminContext, isEmployeeInScope } from '@/lib/auth/adminScope'

function createAdminClient() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    return createClient(supabaseUrl, serviceRoleKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    })
}

export async function PATCH(request: NextRequest) {
    try {
        // Verify the user is an admin
        const supabase = await createServerClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const ctx = await getAdminContext()
        if (!ctx || ctx.role !== 'admin') {
            return NextResponse.json({ error: 'Forbidden - Admin only' }, { status: 403 })
        }

        const body = await request.json()
        const { id, clock_in, clock_out } = body

        if (!id || typeof id !== 'string') {
            return NextResponse.json({ error: 'Attendance record ID is required' }, { status: 400 })
        }

        if (!clock_in || typeof clock_in !== 'string') {
            return NextResponse.json({ error: 'Clock-in time is required' }, { status: 400 })
        }

        const clockInDate = new Date(clock_in)
        if (isNaN(clockInDate.getTime())) {
            return NextResponse.json({ error: 'Invalid clock-in time' }, { status: 400 })
        }

        let clockOutDate: Date | null = null
        if (clock_out !== null && clock_out !== undefined && clock_out !== '') {
            clockOutDate = new Date(clock_out)
            if (isNaN(clockOutDate.getTime())) {
                return NextResponse.json({ error: 'Invalid clock-out time' }, { status: 400 })
            }
            if (clockOutDate <= clockInDate) {
                return NextResponse.json({ error: 'Clock-out must be after clock-in' }, { status: 400 })
            }
        }

        const adminClient = createAdminClient()

        // Fetch existing record to get break_minutes and old values
        const { data: existing, error: fetchError } = await adminClient
            .from('attendance_logs')
            .select('id, clock_in, clock_out, total_hours, break_minutes, employee_id')
            .eq('id', id)
            .single()

        if (fetchError || !existing) {
            return NextResponse.json({ error: 'Attendance record not found' }, { status: 404 })
        }

        // Scoped admins may only edit attendance for their locations' employees.
        if (!(await isEmployeeInScope(ctx, existing.employee_id))) {
            return NextResponse.json({ error: 'Forbidden - outside your assigned locations' }, { status: 403 })
        }

        const breakMinutes = existing.break_minutes || 0

        // Calculate new total_hours if clock_out is set
        let newTotalHours: number | null = null
        if (clockOutDate) {
            const diffMs = clockOutDate.getTime() - clockInDate.getTime()
            newTotalHours = Math.round((diffMs / 3600000 - breakMinutes / 60) * 100) / 100
            if (newTotalHours < 0) newTotalHours = 0

            // Cap at scheduled hours
            const clockInNYDate = new Date(clockInDate.toLocaleString('en-US', { timeZone: 'America/New_York' }))
            const nyDateStr = `${clockInNYDate.getFullYear()}-${String(clockInNYDate.getMonth() + 1).padStart(2, '0')}-${String(clockInNYDate.getDate()).padStart(2, '0')}`
            const { data: sched } = await adminClient
                .from('schedules')
                .select('start_time, end_time')
                .eq('employee_id', existing.employee_id)
                .eq('schedule_date', nyDateStr)
                .neq('status', 'cancelled')
                .order('start_time', { ascending: true })
                .limit(1)
                .single()

            if (sched?.start_time && sched?.end_time) {
                const [sh, sm] = sched.start_time.split(':').map(Number)
                const [eh, em] = sched.end_time.split(':').map(Number)
                const scheduledHours = Math.round(((eh * 60 + em) - (sh * 60 + sm)) / 60 * 100) / 100
                if (scheduledHours > 0 && newTotalHours > scheduledHours) {
                    newTotalHours = scheduledHours
                }
            }
        }

        // Step 1: Update clock_in and clock_out, clear late annotations (admin edit is explicit override)
        const { error: updateError } = await adminClient
            .from('attendance_logs')
            .update({
                clock_in: clockInDate.toISOString(),
                clock_out: clockOutDate ? clockOutDate.toISOString() : null,
                actual_clock_out: null,
                late_clock_out_minutes: null,
                late_flag: false,
                edited_by_admin: true,
            })
            .eq('id', id)

        if (updateError) {
            return NextResponse.json({ error: 'Failed to update attendance record' }, { status: 500 })
        }

        // Step 2: Update total_hours separately (to override any trigger computation)
        const { error: hoursError } = await adminClient
            .from('attendance_logs')
            .update({
                total_hours: newTotalHours,
            })
            .eq('id', id)

        if (hoursError) {
            console.error('Failed to update total_hours:', hoursError.message)
        }

        // Log activity (non-blocking)
        const { ipAddress, userAgent } = getRequestInfo(request.headers)
        logActivity({
            adminId: user.id,
            adminEmail: user.email || 'unknown',
            action: 'attendance_time_edited',
            entityType: 'attendance',
            entityId: id,
            entityName: existing.employee_id,
            details: {
                old_clock_in: existing.clock_in,
                old_clock_out: existing.clock_out,
                new_clock_in: clockInDate.toISOString(),
                new_clock_out: clockOutDate ? clockOutDate.toISOString() : null,
                old_total_hours: existing.total_hours,
                new_total_hours: newTotalHours,
            },
            ipAddress,
            userAgent,
        }).catch(err => console.error('Failed to log activity:', err))

        return NextResponse.json({
            success: true,
            total_hours: newTotalHours,
        })

    } catch {
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
