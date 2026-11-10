import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { logActivity } from '@/lib/activity-log'

function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * Get today's date in New York timezone as YYYY-MM-DD
 */
function getTodayNY(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}

/**
 * Get the current day of the week in New York timezone (lowercase).
 */
function getDayOfWeekNY(): string {
  const nyDayStr = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long' })
  return nyDayStr.toLowerCase()
}

/**
 * Calculate the next scheduled date based on frequency and the last scheduled date.
 * Returns the next date as YYYY-MM-DD string.
 */
function getNextScheduledDate(lastDate: string, frequency: string): string {
  const [y, m, d] = lastDate.split('-').map(Number)
  // Use noon to avoid DST boundary issues
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
      date.setDate(date.getDate() + 1) // Default to daily
  }

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

interface CronLogDetails {
  date: string
  day_of_week: string
  recurring_tasks_count: number
  assigned_employees_count: number
  scheduled_employees: string[]
  tasks_processed: Array<{
    task_id: string
    title: string
    frequency: string
    recurrence_days: string[] | null
    assigned_count: number
    eligible_employees: string[]
    skipped_reason?: string
    employees: Array<{
      employee_id: string
      action: 'create' | 'skip_duplicate' | 'skip_not_due' | 'skip_day_mismatch'
      last_instance_date?: string
      next_due_date?: string
      reason?: string
    }>
    attempted_inserts: number
    actual_inserts: number
    insert_error?: string
  }>
  total_created: number
  errors: string[]
}

/**
 * Save a comprehensive log entry to the cron_logs table.
 */
async function saveCronLog(
  supabaseAdmin: ReturnType<typeof createAdminClient>,
  runDate: string,
  status: 'success' | 'error' | 'partial',
  summary: string,
  details: CronLogDetails
) {
  try {
    await supabaseAdmin.from('cron_logs').insert({
      cron_name: 'create-recurring-tasks',
      run_date: runDate,
      status,
      summary,
      details,
    })
  } catch (err) {
    console.error('[create-recurring-tasks] Failed to save cron log:', err)
  }
}

/**
 * Cron endpoint to create task instances for recurring tasks.
 *
 * Uses tasks.assigned_employee_ids as the source of truth for who should
 * receive each recurring task. For each assigned employee, checks:
 *   1. Do they have a non-cancelled schedule for today?
 *   2. Is it time for their next instance based on frequency?
 *
 * Should be called daily (e.g., via Vercel Cron or external scheduler).
 */
export async function GET(request: NextRequest) {
  const supabaseAdmin = createAdminClient()
  const today = getTodayNY()
  const todayDay = getDayOfWeekNY()

  // Initialize log details
  const logDetails: CronLogDetails = {
    date: today,
    day_of_week: todayDay,
    recurring_tasks_count: 0,
    assigned_employees_count: 0,
    scheduled_employees: [],
    tasks_processed: [],
    total_created: 0,
    errors: [],
  }

  try {
    // Verify cron secret
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    if (!cronSecret) {
      const msg = 'CRON_SECRET not configured'
      console.error(`[create-recurring-tasks] ${msg}`)
      logDetails.errors.push(msg)
      await saveCronLog(supabaseAdmin, today, 'error', msg, logDetails)
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 1. Get all recurring tasks with assigned employees
    const { data: recurringTasks, error: tasksError } = await supabaseAdmin
      .from('tasks')
      .select('id, title, frequency, assigned_employee_ids, recurrence_days')
      .eq('is_recurring', true)

    if (tasksError) {
      const msg = `Error fetching recurring tasks: ${tasksError.message}`
      console.error(`[create-recurring-tasks] ${msg}`)
      logDetails.errors.push(msg)
      await saveCronLog(supabaseAdmin, today, 'error', msg, logDetails)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }

    if (!recurringTasks || recurringTasks.length === 0) {
      const msg = 'No recurring tasks found'
      await saveCronLog(supabaseAdmin, today, 'success', msg, logDetails)
      return NextResponse.json({ message: msg, created: 0 })
    }

    logDetails.recurring_tasks_count = recurringTasks.length

    // 2. Collect all assigned employee IDs across all tasks
    const allAssignedIds = new Set<string>()
    for (const task of recurringTasks) {
      const ids = task.assigned_employee_ids as string[] | null
      if (ids && ids.length > 0) {
        for (const id of ids) {
          allAssignedIds.add(id)
        }
      }
    }

    logDetails.assigned_employees_count = allAssignedIds.size

    if (allAssignedIds.size === 0) {
      const msg = 'No employees assigned to recurring tasks'
      await saveCronLog(supabaseAdmin, today, 'success', msg, logDetails)
      return NextResponse.json({ message: msg, created: 0 })
    }

    // 3. Batch-query schedules: which of these employees have a non-cancelled schedule today?
    const allAssignedArray = Array.from(allAssignedIds)
    const { data: todaySchedules, error: schedulesError } = await supabaseAdmin
      .from('schedules')
      .select('employee_id')
      .eq('schedule_date', today)
      .in('employee_id', allAssignedArray)
      .not('status', 'eq', 'cancelled')

    if (schedulesError) {
      const msg = `Error fetching schedules: ${schedulesError.message}`
      console.error(`[create-recurring-tasks] ${msg}`)
      logDetails.errors.push(msg)
      await saveCronLog(supabaseAdmin, today, 'error', msg, logDetails)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }

    const scheduledEmployeeIds = new Set(
      (todaySchedules || []).map((s: { employee_id: string }) => s.employee_id)
    )

    logDetails.scheduled_employees = Array.from(scheduledEmployeeIds)

    if (scheduledEmployeeIds.size === 0) {
      const msg = `No assigned employees scheduled today (${allAssignedIds.size} assigned, 0 scheduled)`
      await saveCronLog(supabaseAdmin, today, 'success', msg, logDetails)
      return NextResponse.json({ message: 'No assigned employees scheduled today', created: 0 })
    }

    let totalCreated = 0
    const createdDetails: Array<{ task: string; employee_id: string; scheduled_date: string }> = []
    let hasErrors = false

    for (const task of recurringTasks) {
      const assignedIds = task.assigned_employee_ids as string[] | null

      const taskLog: CronLogDetails['tasks_processed'][0] = {
        task_id: task.id,
        title: task.title,
        frequency: task.frequency || 'daily',
        recurrence_days: task.recurrence_days as string[] | null,
        assigned_count: assignedIds?.length || 0,
        eligible_employees: [],
        employees: [],
        attempted_inserts: 0,
        actual_inserts: 0,
      }

      if (!assignedIds || assignedIds.length === 0) {
        taskLog.skipped_reason = 'no assigned employees'
        logDetails.tasks_processed.push(taskLog)
        continue
      }

      // If recurrence_days is set, check if today matches
      const recurrenceDays = task.recurrence_days as string[] | null
      if (recurrenceDays && recurrenceDays.length > 0) {
        if (!recurrenceDays.includes(todayDay)) {
          taskLog.skipped_reason = `recurrence_days ${JSON.stringify(recurrenceDays)} does not include "${todayDay}"`
          logDetails.tasks_processed.push(taskLog)
          continue
        }
      }

      const frequency = task.frequency || 'daily'

      // Filter to only employees who are scheduled today
      const eligibleEmployees = assignedIds.filter(id => scheduledEmployeeIds.has(id))
      taskLog.eligible_employees = eligibleEmployees

      if (eligibleEmployees.length === 0) {
        taskLog.skipped_reason = `no eligible employees (${assignedIds.length} assigned, none scheduled today)`
        logDetails.tasks_processed.push(taskLog)
        continue
      }

      // 4. Get the latest task_instance per employee for this task (for frequency check)
      const { data: latestInstances, error: instancesError } = await supabaseAdmin
        .from('task_instances')
        .select('employee_id, scheduled_date')
        .eq('task_id', task.id)
        .in('employee_id', eligibleEmployees)
        .order('scheduled_date', { ascending: false })

      if (instancesError) {
        const msg = `Error fetching instances for task ${task.id}: ${instancesError.message}`
        console.error(`[create-recurring-tasks] ${msg}`)
        logDetails.errors.push(msg)
        taskLog.skipped_reason = `query error: ${instancesError.message}`
        logDetails.tasks_processed.push(taskLog)
        hasErrors = true
        continue
      }

      // Group by employee, keep only the latest scheduled_date per employee
      const latestByEmployee = new Map<string, string>()
      if (latestInstances) {
        for (const instance of latestInstances) {
          if (!latestByEmployee.has(instance.employee_id)) {
            latestByEmployee.set(instance.employee_id, instance.scheduled_date)
          }
        }
      }

      // 5. For each eligible employee, determine if a new instance is due
      const newInstances: Array<{ task_id: string; employee_id: string; scheduled_date: string; status: string }> = []

      for (const employeeId of eligibleEmployees) {
        const lastDate = latestByEmployee.get(employeeId)

        if (!lastDate) {
          // No previous instance — create one for today
          taskLog.employees.push({
            employee_id: employeeId,
            action: 'create',
            reason: 'no previous instance',
          })
          newInstances.push({
            task_id: task.id,
            employee_id: employeeId,
            scheduled_date: today,
            status: 'pending',
          })
          continue
        }

        // Calculate what the next date should be
        let nextDate = getNextScheduledDate(lastDate, frequency)

        // If the employee missed several days, schedule for today
        if (nextDate < today) {
          nextDate = today
        }

        // Only create if due (nextDate <= today)
        if (nextDate <= today) {
          taskLog.employees.push({
            employee_id: employeeId,
            action: 'create',
            last_instance_date: lastDate,
            next_due_date: nextDate,
          })
          newInstances.push({
            task_id: task.id,
            employee_id: employeeId,
            scheduled_date: nextDate,
            status: 'pending',
          })
        } else {
          taskLog.employees.push({
            employee_id: employeeId,
            action: 'skip_not_due',
            last_instance_date: lastDate,
            next_due_date: nextDate,
            reason: `next due ${nextDate} > today ${today}`,
          })
        }
      }

      taskLog.attempted_inserts = newInstances.length

      if (newInstances.length === 0) {
        logDetails.tasks_processed.push(taskLog)
        continue
      }

      // 6. Insert new instances (ignore duplicates via unique constraint)
      const { data: inserted, error: insertError } = await supabaseAdmin
        .from('task_instances')
        .upsert(newInstances, {
          onConflict: 'task_id,employee_id,scheduled_date',
          ignoreDuplicates: true,
        })
        .select('id, employee_id, scheduled_date')

      if (insertError) {
        const msg = `Error inserting instances for task ${task.id} "${task.title}": ${insertError.message}`
        console.error(`[create-recurring-tasks] ${msg}`)
        logDetails.errors.push(msg)
        taskLog.insert_error = insertError.message
        hasErrors = true
        logDetails.tasks_processed.push(taskLog)
        continue
      }

      const actualInserted = inserted?.length ?? 0
      taskLog.actual_inserts = actualInserted

      // Mark duplicates in the employee log
      if (actualInserted < newInstances.length) {
        const insertedEmployeeIds = new Set((inserted || []).map(i => i.employee_id))
        for (const emp of taskLog.employees) {
          if (emp.action === 'create' && !insertedEmployeeIds.has(emp.employee_id)) {
            emp.action = 'skip_duplicate'
            emp.reason = 'already exists (upsert duplicate)'
          }
        }
      }

      if (inserted && inserted.length > 0) {
        totalCreated += inserted.length
        for (const inst of inserted) {
          createdDetails.push({
            task: task.title,
            employee_id: inst.employee_id,
            scheduled_date: inst.scheduled_date,
          })
        }
      }

      logDetails.tasks_processed.push(taskLog)
    }

    logDetails.total_created = totalCreated

    // Save comprehensive cron log
    const status = hasErrors ? 'partial' : 'success'
    const summary = `Created ${totalCreated} instance(s) for ${today} (${todayDay}). ${scheduledEmployeeIds.size} scheduled employees, ${recurringTasks.length} recurring tasks.${hasErrors ? ' Some errors occurred.' : ''}`
    await saveCronLog(supabaseAdmin, today, status, summary, logDetails)

    // Log activity (existing behavior)
    if (totalCreated > 0) {
      await logActivity({
        adminId: null,
        adminEmail: 'system (recurring-tasks cron)',
        action: 'recurring_tasks_created',
        entityType: 'task_instance',
        entityId: undefined,
        entityName: `${totalCreated} recurring task instance(s)`,
        details: {
          date: today,
          created: totalCreated,
          instances: createdDetails.slice(0, 50),
        },
      })
    }

    console.log(`[create-recurring-tasks] ${summary}`)

    return NextResponse.json({
      date: today,
      created: totalCreated,
      details: createdDetails,
    })
  } catch (err) {
    const msg = `Unexpected error: ${err instanceof Error ? err.message : String(err)}`
    console.error(`[create-recurring-tasks] ${msg}`)
    logDetails.errors.push(msg)
    await saveCronLog(supabaseAdmin, today, 'error', msg, logDetails)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
