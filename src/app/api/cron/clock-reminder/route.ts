import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { logActivity } from '@/lib/activity-log'
import { sendClockInReminderEmail, sendClockOutReminderEmail } from '@/lib/email'
import { sendClockInReminderSMS, sendClockOutReminderSMS } from '@/lib/sms'
import { getUsersWithPush, sendPushToUser, type PushPayload } from '@/lib/push'
import { getTodayNY, formatDateOnly, formatTimeString, NY_TIMEZONE } from '@/lib/utils'

// GET /api/cron/clock-reminder  (root crontab: every 5 minutes)
//
// Four reminders, all keyed off today's schedules (NY time):
//
//   1. Shift start (0-10 min after start_time, not clocked in)
//        -> browser push "Your shift is starting. Don't forget to clock in."
//   2. Missed clock-in (10+ min after start_time, still not clocked in)
//        -> email + push; SMS only if the employee has no push subscription
//   3. Shift end (0-10 min after end_time, clocked in, not clocked out)
//        -> browser push "Your shift is ending. Don't forget to clock out."
//   4. Missed clock-out (10+ min after end_time, still clocked in)
//        -> email + push; SMS only if no push subscription
//
// Plus, independent of schedules:
//
//   5. Lunch over (break_start >= 30 min ago, still on lunch)
//        -> browser push + in-app notification, once per lunch
//
// Push is free (no Twilio credits). Each reminder also drops an in-app
// notification row so it shows up under the bell even if push is off.

function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/** Current time in NY timezone as minutes since midnight */
function getNYMinutesSinceMidnight(): number {
  const nyTimeStr = new Date().toLocaleString('en-US', {
    timeZone: NY_TIMEZONE,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  })
  const [h, m] = nyTimeStr.split(':').map(Number)
  // en-US with hour12:false reports midnight as "24:00" — normalize to 0
  return (h % 24) * 60 + m
}

/** Parse "09:00" / "17:00:00" to minutes since midnight */
function parseTimeMinutes(time: string): number | null {
  if (!time) return null
  const parts = time.split(':')
  if (parts.length < 2) return null
  const h = parseInt(parts[0], 10)
  const m = parseInt(parts[1], 10)
  if (isNaN(h) || isNaN(m)) return null
  return h * 60 + m
}

/** Minutes after the shift boundary before the "missed punch" reminder goes out. */
const REMINDER_DELAY_MINUTES = 10
/** Lunch length after which the "end lunch" reminder fires. */
const LUNCH_REMINDER_MINUTES = 30

type Admin = ReturnType<typeof createAdminClient>

async function addInAppNotification(
  supabase: Admin,
  userId: string,
  n: { type: string; title: string; body: string; link: string; dedupeKey: string }
) {
  const { error } = await supabase
    .from('notifications')
    .upsert(
      { user_id: userId, type: n.type, title: n.title, body: n.body, link: n.link, dedupe_key: n.dedupeKey },
      { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true }
    )
  if (error) console.error('[clock-reminder] notification insert failed:', error.message)
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    if (!cronSecret) {
      console.error('[clock-reminder] CRON_SECRET not configured')
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
    }
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabaseAdmin = createAdminClient()
    const todayNY = getTodayNY()
    const nowMinutes = getNYMinutesSinceMidnight()
    const nowIso = new Date().toISOString()

    const counts = {
      shiftStartPush: 0,
      clockInReminders: 0,
      shiftEndPush: 0,
      clockOutReminders: 0,
      lunchReminders: 0,
      pushSent: 0,
      smsSent: 0,
    }

    // ------------------------------------------------------------------
    // Schedules for today that still have at least one reminder pending
    // ------------------------------------------------------------------
    const { data: schedules, error: fetchError } = await supabaseAdmin
      .from('schedules')
      .select(`
        id,
        employee_id,
        schedule_date,
        start_time,
        end_time,
        location,
        clock_in_reminder_sent,
        clock_out_reminder_sent,
        shift_start_push_sent,
        shift_end_push_sent,
        employees!inner(display_name, phone_number, is_active, profiles(email))
      `)
      .eq('schedule_date', todayNY)
      .in('status', ['confirmed', 'pending'])
      .or('clock_in_reminder_sent.eq.false,clock_out_reminder_sent.eq.false,shift_start_push_sent.eq.false,shift_end_push_sent.eq.false')
      .limit(500)

    if (fetchError) {
      console.error('[clock-reminder] Fetch schedules error:', fetchError.message)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }

    const scheduleRows = schedules || []

    if (scheduleRows.length > 0) {
      const employeeIds = Array.from(new Set(scheduleRows.map(s => s.employee_id)))

      const [{ data: attendanceLogs, error: attendanceError }, pushUsers] = await Promise.all([
        supabaseAdmin
          .from('attendance_logs')
          .select('employee_id, clock_in, clock_out')
          .in('employee_id', employeeIds)
          .gte('clock_in', `${todayNY}T00:00:00`)
          .lt('clock_in', `${todayNY}T23:59:59`),
        getUsersWithPush(employeeIds),
      ])

      if (attendanceError) {
        console.error('[clock-reminder] Fetch attendance error:', attendanceError.message)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
      }

      const clockedIn = new Set<string>()
      const clockedOut = new Set<string>()
      for (const log of (attendanceLogs || [])) {
        clockedIn.add(log.employee_id)
        if (log.clock_out) clockedOut.add(log.employee_id)
      }

      for (const schedule of scheduleRows) {
        const employee = schedule.employees as unknown as {
          display_name?: string
          phone_number?: string
          is_active?: boolean
          profiles?: { email?: string } | null
        } | null

        if (!employee?.is_active) continue

        const employeeId = schedule.employee_id as string
        const employeeName = employee.display_name || 'Employee'
        const employeeEmail = employee.profiles?.email
        const hasPush = pushUsers.has(employeeId)
        const formattedDate = formatDateOnly(schedule.schedule_date)
        const formattedStart = formatTimeString(schedule.start_time)
        const formattedEnd = formatTimeString(schedule.end_time)
        const startMinutes = parseTimeMinutes(schedule.start_time)
        const endMinutes = parseTimeMinutes(schedule.end_time)
        const isClockedIn = clockedIn.has(employeeId)
        const isClockedOut = clockedOut.has(employeeId)

        const push = async (payload: PushPayload) => {
          if (!hasPush) return false
          const r = await sendPushToUser(employeeId, payload)
          counts.pushSent += r.sent
          if (r.errors.length) console.error(`[clock-reminder] push errors for ${employeeId}:`, r.errors)
          return r.sent > 0
        }

        // --- 1. Shift start nudge (0 .. +10 min) ---
        if (!schedule.shift_start_push_sent && startMinutes !== null && nowMinutes >= startMinutes) {
          if (nowMinutes < startMinutes + REMINDER_DELAY_MINUTES && !isClockedIn) {
            const payload: PushPayload = {
              title: 'Your shift is starting',
              body: `Hi ${employeeName}, your ${formattedStart} shift is starting. Don't forget to clock in.`,
              url: '/employee',
              tag: `shift-start-${schedule.id}`,
              requireInteraction: true,
            }
            await push(payload)
            await addInAppNotification(supabaseAdmin, employeeId, {
              type: 'clock',
              title: payload.title,
              body: payload.body,
              link: '/employee',
              dedupeKey: `shift_start:${schedule.id}`,
            })
            counts.shiftStartPush++
          }
          // Mark done whether we sent it, they already clocked in, or the
          // window passed (the +10 reminder takes over from here).
          await supabaseAdmin.from('schedules').update({ shift_start_push_sent: true }).eq('id', schedule.id)
        }

        // --- 2. Missed clock-in (+10 min) ---
        if (!schedule.clock_in_reminder_sent && startMinutes !== null && employeeEmail) {
          if (nowMinutes >= startMinutes + REMINDER_DELAY_MINUTES && !isClockedIn) {
            const emailResult = await sendClockInReminderEmail({
              employeeName,
              employeeEmail,
              scheduleDate: formattedDate,
              startTime: formattedStart,
              endTime: formattedEnd,
              location: schedule.location || undefined,
            })

            if (emailResult.success) {
              const pushed = await push({
                title: "You haven't clocked in",
                body: `Your shift started at ${formattedStart}. Please clock in now.`,
                url: '/employee',
                tag: `clock-in-${schedule.id}`,
                requireInteraction: true,
              })
              // SMS costs credits: only when push can't reach this employee.
              if (!pushed && employee.phone_number) {
                const smsResult = await sendClockInReminderSMS({
                  employeeName,
                  employeePhone: employee.phone_number,
                  startTime: formattedStart,
                })
                if (smsResult.success) counts.smsSent++
              }
              await addInAppNotification(supabaseAdmin, employeeId, {
                type: 'clock',
                title: "You haven't clocked in",
                body: `Your shift started at ${formattedStart}. Please clock in now.`,
                link: '/employee',
                dedupeKey: `clock_in_reminder:${schedule.id}`,
              })

              await supabaseAdmin
                .from('schedules')
                .update({ clock_in_reminder_sent: true, shift_start_push_sent: true })
                .eq('id', schedule.id)

              await logActivity({
                adminId: null,
                adminEmail: 'system (clock-reminder cron)',
                action: 'clock_in_reminder_sent',
                entityType: 'schedule',
                entityId: schedule.id,
                entityName: `${employeeName} - ${formattedDate}`,
                details: {
                  employee_id: employeeId,
                  schedule_date: schedule.schedule_date,
                  start_time: schedule.start_time,
                  channels: { email: true, push: pushed, sms: !pushed && !!employee.phone_number },
                },
              })

              counts.clockInReminders++
            } else {
              console.error(`[clock-reminder] Clock-in email failed for schedule ${schedule.id}:`, emailResult.error)
            }
          }
        }

        // --- 3. Shift end nudge (0 .. +10 min) ---
        if (!schedule.shift_end_push_sent && endMinutes !== null && nowMinutes >= endMinutes) {
          if (nowMinutes < endMinutes + REMINDER_DELAY_MINUTES && isClockedIn && !isClockedOut) {
            const payload: PushPayload = {
              title: 'Your shift is ending',
              body: `Hi ${employeeName}, your shift ends at ${formattedEnd}. Don't forget to clock out.`,
              url: '/employee',
              tag: `shift-end-${schedule.id}`,
              requireInteraction: true,
            }
            await push(payload)
            await addInAppNotification(supabaseAdmin, employeeId, {
              type: 'clock',
              title: payload.title,
              body: payload.body,
              link: '/employee',
              dedupeKey: `shift_end:${schedule.id}`,
            })
            counts.shiftEndPush++
          }
          await supabaseAdmin.from('schedules').update({ shift_end_push_sent: true }).eq('id', schedule.id)
        }

        // --- 4. Missed clock-out (+10 min) ---
        if (!schedule.clock_out_reminder_sent && endMinutes !== null && employeeEmail) {
          if (nowMinutes >= endMinutes + REMINDER_DELAY_MINUTES && isClockedIn && !isClockedOut) {
            const emailResult = await sendClockOutReminderEmail({
              employeeName,
              employeeEmail,
              scheduleDate: formattedDate,
              startTime: formattedStart,
              endTime: formattedEnd,
              location: schedule.location || undefined,
            })

            if (emailResult.success) {
              const pushed = await push({
                title: "You haven't clocked out",
                body: `Your shift ended at ${formattedEnd}. Please clock out now.`,
                url: '/employee',
                tag: `clock-out-${schedule.id}`,
                requireInteraction: true,
              })
              if (!pushed && employee.phone_number) {
                const smsResult = await sendClockOutReminderSMS({
                  employeeName,
                  employeePhone: employee.phone_number,
                  endTime: formattedEnd,
                })
                if (smsResult.success) counts.smsSent++
              }
              await addInAppNotification(supabaseAdmin, employeeId, {
                type: 'clock',
                title: "You haven't clocked out",
                body: `Your shift ended at ${formattedEnd}. Please clock out now.`,
                link: '/employee',
                dedupeKey: `clock_out_reminder:${schedule.id}`,
              })

              await supabaseAdmin
                .from('schedules')
                .update({ clock_out_reminder_sent: true, shift_end_push_sent: true })
                .eq('id', schedule.id)

              await logActivity({
                adminId: null,
                adminEmail: 'system (clock-reminder cron)',
                action: 'clock_out_reminder_sent',
                entityType: 'schedule',
                entityId: schedule.id,
                entityName: `${employeeName} - ${formattedDate}`,
                details: {
                  employee_id: employeeId,
                  schedule_date: schedule.schedule_date,
                  end_time: schedule.end_time,
                  channels: { email: true, push: pushed, sms: !pushed && !!employee.phone_number },
                },
              })

              counts.clockOutReminders++
            } else {
              console.error(`[clock-reminder] Clock-out email failed for schedule ${schedule.id}:`, emailResult.error)
            }
          }
        }
      }
    }

    // ------------------------------------------------------------------
    // 5. Lunch over: on lunch for 30+ minutes, not reminded yet
    // ------------------------------------------------------------------
    const lunchCutoff = new Date(Date.now() - LUNCH_REMINDER_MINUTES * 60 * 1000).toISOString()
    const { data: lunches, error: lunchError } = await supabaseAdmin
      .from('attendance_logs')
      .select('id, employee_id, break_start, employees!inner(display_name, is_active)')
      .is('clock_out', null)
      .not('break_start', 'is', null)
      .is('break_reminder_sent_at', null)
      .lte('break_start', lunchCutoff)
      .limit(200)

    if (lunchError) {
      console.error('[clock-reminder] Fetch lunches error:', lunchError.message)
    } else {
      for (const row of (lunches || [])) {
        const employee = row.employees as unknown as { display_name?: string; is_active?: boolean } | null
        if (!employee?.is_active) continue
        const employeeId = row.employee_id as string
        const minutes = Math.floor((Date.now() - new Date(row.break_start as string).getTime()) / 60000)
        const payload: PushPayload = {
          title: 'Lunch is over',
          body: `Hi ${employee.display_name || 'there'}, you've been on lunch for ${minutes} minutes. Tap End Lunch to clock back in.`,
          url: '/employee',
          tag: `lunch-${row.id}`,
          requireInteraction: true,
        }
        const r = await sendPushToUser(employeeId, payload)
        counts.pushSent += r.sent
        if (r.errors.length) console.error(`[clock-reminder] lunch push errors for ${employeeId}:`, r.errors)
        await addInAppNotification(supabaseAdmin, employeeId, {
          type: 'clock',
          title: payload.title,
          body: payload.body,
          link: '/employee',
          dedupeKey: `lunch_reminder:${row.id}:${row.break_start}`,
        })
        await supabaseAdmin
          .from('attendance_logs')
          .update({ break_reminder_sent_at: nowIso })
          .eq('id', row.id)
        counts.lunchReminders++
      }
    }

    console.log(`[clock-reminder] ${JSON.stringify(counts)}`)

    return NextResponse.json({ ...counts, date: todayNY })
  } catch (err) {
    console.error('[clock-reminder] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
