import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { logActivity } from '@/lib/activity-log'
import { sendTaskDeadlineReminderEmail } from '@/lib/email'
import { sendTaskDeadlineReminderSMS } from '@/lib/sms'
import { getTodayNY, formatDateOnly, formatTimeString, NY_TIMEZONE } from '@/lib/utils'

function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * Get current time in NY timezone as minutes since midnight
 */
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

/**
 * Parse a cutoff_time string (e.g. "17:00" or "17:00:00") to minutes since midnight
 */
function parseCutoffMinutes(cutoffTime: string): number | null {
  if (!cutoffTime) return null
  const parts = cutoffTime.split(':')
  if (parts.length < 2) return null
  const h = parseInt(parts[0], 10)
  const m = parseInt(parts[1], 10)
  if (isNaN(h) || isNaN(m)) return null
  return h * 60 + m
}

export async function GET(request: NextRequest) {
  try {
    // Verify cron secret
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    if (!cronSecret) {
      console.error('[task-deadline-reminder] CRON_SECRET not configured')
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabaseAdmin = createAdminClient()
    const todayNY = getTodayNY()
    const nowMinutes = getNYMinutesSinceMidnight()

    // Window: cutoff_time between now+45min and now+75min
    // This 30-minute window handles 15-minute cron intervals with overlap
    const windowStart = nowMinutes + 45
    const windowEnd = nowMinutes + 75

    // Query pending task instances for today that haven't had reminders sent
    const { data: instances, error: fetchError } = await supabaseAdmin
      .from('task_instances')
      .select(`
        id,
        task_id,
        employee_id,
        scheduled_date,
        tasks(title, description, location, cutoff_time),
        employees(display_name, phone_number, is_active, profiles(email))
      `)
      .eq('scheduled_date', todayNY)
      .eq('status', 'pending')
      .is('reminder_sent_at', null)
      .limit(200)

    if (fetchError) {
      console.error('[task-deadline-reminder] Fetch error:', fetchError.message)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }

    let remindersSent = 0
    let smsSent = 0

    for (const instance of (instances || [])) {
      const task = instance.tasks as { title?: string; description?: string; location?: string; cutoff_time?: string } | null
      const employee = instance.employees as { display_name?: string; phone_number?: string; is_active?: boolean; profiles?: { email?: string } | null } | null

      if (!task?.cutoff_time || !employee) continue

      // Check if employee is active
      if (!employee.is_active) continue

      // Check if employee has an email
      const employeeEmail = employee.profiles?.email
      if (!employeeEmail) continue

      // Check if cutoff_time falls within our reminder window
      const cutoffMinutes = parseCutoffMinutes(task.cutoff_time)
      if (cutoffMinutes === null) continue

      // Handle window that might cross midnight (unlikely but safe)
      let inWindow: boolean
      if (windowStart >= 0 && windowEnd <= 1440) {
        inWindow = cutoffMinutes >= windowStart && cutoffMinutes <= windowEnd
      } else if (windowEnd > 1440) {
        // Window crosses midnight
        inWindow = cutoffMinutes >= windowStart || cutoffMinutes <= (windowEnd - 1440)
      } else {
        inWindow = false
      }

      if (!inWindow) continue

      const employeeName = employee.display_name || 'Employee'
      const formattedDate = formatDateOnly(instance.scheduled_date)
      const formattedCutoff = formatTimeString(task.cutoff_time)

      // Send email
      const emailResult = await sendTaskDeadlineReminderEmail({
        employeeName,
        employeeEmail,
        taskTitle: task.title || 'Untitled Task',
        taskDescription: task.description || undefined,
        scheduledDate: formattedDate,
        cutoffTime: formattedCutoff,
        location: task.location || undefined,
      })

      if (!emailResult.success) {
        console.error(`[task-deadline-reminder] Email failed for instance ${instance.id}:`, emailResult.error)
        continue
      }

      // Send SMS if phone number available
      if (employee.phone_number) {
        const smsResult = await sendTaskDeadlineReminderSMS({
          employeeName,
          employeePhone: employee.phone_number,
          taskTitle: task.title || 'Untitled Task',
          cutoffTime: formattedCutoff,
        })
        if (smsResult.success) {
          smsSent++
        }
      }

      // Mark reminder as sent (only after successful email)
      const { error: updateError } = await supabaseAdmin
        .from('task_instances')
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq('id', instance.id)

      if (updateError) {
        console.error(`[task-deadline-reminder] Update error for instance ${instance.id}:`, updateError.message)
        continue
      }

      // Log activity
      await logActivity({
        adminId: null,
        adminEmail: 'system (task-deadline-reminder cron)',
        action: 'task_deadline_reminder_sent',
        entityType: 'task_instance',
        entityId: instance.id,
        entityName: `${task.title || 'Untitled Task'} - ${employeeName}`,
        details: {
          task_id: instance.task_id,
          employee_id: instance.employee_id,
          cutoff_time: task.cutoff_time,
          scheduled_date: instance.scheduled_date,
        },
      })

      remindersSent++
    }

    console.log(`[task-deadline-reminder] Sent ${remindersSent} email reminders, ${smsSent} SMS reminders`)

    return NextResponse.json({
      remindersSent,
      smsSent,
      date: todayNY,
    })
  } catch (err) {
    console.error('[task-deadline-reminder] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
