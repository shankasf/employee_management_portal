import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerSupabase } from '@/lib/supabase/server'

function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function getTodayNY(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}

function getDayOfWeekForDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d, 12, 0, 0)
  return date.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase()
}

function getNextScheduledDate(lastDate: string, frequency: string): string {
  const [y, m, d] = lastDate.split('-').map(Number)
  const date = new Date(y, m - 1, d, 12, 0, 0)

  switch (frequency) {
    case 'daily':
      date.setDate(date.getDate() + 1)
      break
    case 'weekly':
      date.setDate(date.getDate() + 7)
      break
    case 'monthly':
      date.setMonth(date.getMonth() + 1)
      break
    default:
      date.setDate(date.getDate() + 1)
  }

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

/**
 * Triggered after an admin creates/updates schedules.
 * Creates any missing recurring task instances for the given employees and dates.
 */
export async function POST(request: NextRequest) {
  try {
    // Auth check
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabaseAdmin = createAdminClient()

    // Admin role check
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { employee_ids, dates } = body as { employee_ids: string[]; dates: string[] }

    if (!Array.isArray(employee_ids) || employee_ids.length === 0) {
      return NextResponse.json({ error: 'employee_ids required' }, { status: 400 })
    }
    if (!Array.isArray(dates) || dates.length === 0) {
      return NextResponse.json({ error: 'dates required' }, { status: 400 })
    }
    if (employee_ids.length > 50 || dates.length > 60) {
      return NextResponse.json({ error: 'Too many items' }, { status: 400 })
    }

    for (const id of employee_ids) {
      if (!UUID_REGEX.test(id)) {
        return NextResponse.json({ error: 'Invalid employee_id format' }, { status: 400 })
      }
    }
    for (const d of dates) {
      if (!DATE_REGEX.test(d)) {
        return NextResponse.json({ error: 'Invalid date format (YYYY-MM-DD)' }, { status: 400 })
      }
    }

    // Only materialize TODAY's instance. Recurring tasks follow a one-open-instance-per
    // (task, employee) model: the daily cron creates each day's instance when that day
    // arrives, and the completion hook generates the next one. Pre-creating an instance for
    // every future scheduled date here piled up dozens of duplicate "pending" tasks for a
    // single recurring task (e.g. a whole month of "Daily Customer Review Request").
    const today = getTodayNY()
    const validDates = dates.filter(d => d === today)
    if (validDates.length === 0) {
      return NextResponse.json({ created: 0, message: 'No current dates to process' })
    }

    // Get all recurring tasks that have any of these employees assigned
    const { data: recurringTasks, error: tasksError } = await supabaseAdmin
      .from('tasks')
      .select('id, title, frequency, assigned_employee_ids, recurrence_days')
      .eq('is_recurring', true)

    if (tasksError) {
      console.error('[trigger-recurring-tasks] Error fetching tasks:', tasksError.message)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }

    if (!recurringTasks || recurringTasks.length === 0) {
      return NextResponse.json({ created: 0, message: 'No recurring tasks found' })
    }

    // Filter to tasks that have at least one of the given employees assigned
    const employeeSet = new Set(employee_ids)
    const relevantTasks = recurringTasks.filter(task => {
      const assigned = task.assigned_employee_ids as string[] | null
      return assigned?.some(id => employeeSet.has(id))
    })

    if (relevantTasks.length === 0) {
      return NextResponse.json({ created: 0, message: 'No recurring tasks assigned to these employees' })
    }

    let totalCreated = 0
    const details: Array<{ task: string; employee_id: string; scheduled_date: string }> = []

    // Process each date
    for (const date of validDates) {
      const dayOfWeek = getDayOfWeekForDate(date)

      // Check which of the requested employees have a non-cancelled schedule for this date
      const { data: scheduledRows, error: schedError } = await supabaseAdmin
        .from('schedules')
        .select('employee_id')
        .eq('schedule_date', date)
        .in('employee_id', employee_ids)
        .not('status', 'eq', 'cancelled')

      if (schedError) {
        console.error(`[trigger-recurring-tasks] Error fetching schedules for ${date}:`, schedError.message)
        continue
      }

      const scheduledForDate = new Set(
        (scheduledRows || []).map((s: { employee_id: string }) => s.employee_id)
      )

      if (scheduledForDate.size === 0) continue

      for (const task of relevantTasks) {
        const assignedIds = task.assigned_employee_ids as string[] | null
        if (!assignedIds || assignedIds.length === 0) continue

        // Check recurrence_days
        const recurrenceDays = task.recurrence_days as string[] | null
        if (recurrenceDays && recurrenceDays.length > 0) {
          if (!recurrenceDays.includes(dayOfWeek)) continue
        }

        const frequency = task.frequency || 'daily'

        // Only process employees that are in the request, assigned to the task, AND scheduled for this date
        const eligibleEmployees = assignedIds.filter(id => employeeSet.has(id) && scheduledForDate.has(id))
        if (eligibleEmployees.length === 0) continue

        // Get latest instances for these employees (include status so we can skip anyone
        // who already has an open pending instance for this task — one-open-instance model)
        const { data: latestInstances, error: instancesError } = await supabaseAdmin
          .from('task_instances')
          .select('employee_id, scheduled_date, status')
          .eq('task_id', task.id)
          .in('employee_id', eligibleEmployees)
          .order('scheduled_date', { ascending: false })

        if (instancesError) {
          console.error(`[trigger-recurring-tasks] Error fetching instances for task ${task.id}:`, instancesError.message)
          continue
        }

        const latestByEmployee = new Map<string, string>()
        const hasOpenPending = new Set<string>()
        if (latestInstances) {
          for (const instance of latestInstances) {
            if (!latestByEmployee.has(instance.employee_id)) {
              latestByEmployee.set(instance.employee_id, instance.scheduled_date)
            }
            if (instance.status === 'pending') {
              hasOpenPending.add(instance.employee_id)
            }
          }
        }

        const newInstances: Array<{ task_id: string; employee_id: string; scheduled_date: string; status: string }> = []

        for (const employeeId of eligibleEmployees) {
          // Already has something pending for this recurring task — don't pile up duplicates
          if (hasOpenPending.has(employeeId)) continue

          const lastDate = latestByEmployee.get(employeeId)

          if (!lastDate) {
            newInstances.push({ task_id: task.id, employee_id: employeeId, scheduled_date: date, status: 'pending' })
            continue
          }

          let nextDate = getNextScheduledDate(lastDate, frequency)
          if (nextDate < date) nextDate = date
          if (nextDate <= date) {
            newInstances.push({ task_id: task.id, employee_id: employeeId, scheduled_date: nextDate, status: 'pending' })
          }
        }

        if (newInstances.length === 0) continue

        const { data: inserted, error: insertError } = await supabaseAdmin
          .from('task_instances')
          .upsert(newInstances, {
            onConflict: 'task_id,employee_id,scheduled_date',
            ignoreDuplicates: true,
          })
          .select('id, employee_id, scheduled_date')

        if (insertError) {
          console.error(`[trigger-recurring-tasks] Insert error for task ${task.id}:`, insertError.message)
          continue
        }

        if (inserted && inserted.length > 0) {
          totalCreated += inserted.length
          for (const inst of inserted) {
            details.push({ task: task.title, employee_id: inst.employee_id, scheduled_date: inst.scheduled_date })
          }
        }
      }
    }

    console.log(`[trigger-recurring-tasks] Created ${totalCreated} instance(s) for employees [${employee_ids.join(', ')}] on dates [${validDates.join(', ')}]`)

    return NextResponse.json({ created: totalCreated, details })
  } catch (err) {
    console.error('[trigger-recurring-tasks] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
