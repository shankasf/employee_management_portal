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

/**
 * Cron endpoint to create task instances for recurring tasks.
 *
 * For each recurring task, finds the latest scheduled_date per employee,
 * and creates a new pending instance for the next occurrence if it's due.
 *
 * Should be called daily (e.g., via Vercel Cron or external scheduler).
 */
export async function GET(request: NextRequest) {
  try {
    // Verify cron secret
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    if (!cronSecret) {
      console.error('[create-recurring-tasks] CRON_SECRET not configured')
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabaseAdmin = createAdminClient()
    const today = getTodayNY()

    // 1. Get all recurring tasks
    const { data: recurringTasks, error: tasksError } = await supabaseAdmin
      .from('tasks')
      .select('id, title, frequency')
      .eq('is_recurring', true)

    if (tasksError) {
      console.error('[create-recurring-tasks] Error fetching recurring tasks:', tasksError.message)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }

    if (!recurringTasks || recurringTasks.length === 0) {
      return NextResponse.json({ message: 'No recurring tasks found', created: 0 })
    }

    let totalCreated = 0
    const details: Array<{ task: string; employee_id: string; scheduled_date: string }> = []

    for (const task of recurringTasks) {
      const frequency = task.frequency || 'daily'

      // 2. For this task, find the latest task_instance per employee
      //    We get all instances for this task, ordered by scheduled_date desc,
      //    and group by employee to find the most recent one per employee.
      const { data: latestInstances, error: instancesError } = await supabaseAdmin
        .from('task_instances')
        .select('employee_id, scheduled_date, status')
        .eq('task_id', task.id)
        .order('scheduled_date', { ascending: false })

      if (instancesError) {
        console.error(`[create-recurring-tasks] Error fetching instances for task ${task.id}:`, instancesError.message)
        continue
      }

      if (!latestInstances || latestInstances.length === 0) {
        // No instances exist yet - nothing to recur from
        continue
      }

      // Group by employee, keep only the latest scheduled_date per employee
      const latestByEmployee = new Map<string, { scheduled_date: string; status: string }>()
      for (const instance of latestInstances) {
        if (!latestByEmployee.has(instance.employee_id)) {
          latestByEmployee.set(instance.employee_id, {
            scheduled_date: instance.scheduled_date,
            status: instance.status,
          })
        }
      }

      // 3. For each employee, check if a new instance is due
      const newInstances: Array<{ task_id: string; employee_id: string; scheduled_date: string; status: string }> = []

      const entries = Array.from(latestByEmployee.entries())
      for (const [employeeId, latest] of entries) {
        // Only create next instance if the latest one is completed or overdue,
        // or if the scheduled_date has passed (even if still pending - means it was missed)
        const lastDate = latest.scheduled_date

        // Calculate what the next date should be
        let nextDate = getNextScheduledDate(lastDate, frequency)

        // For daily tasks, if the employee missed several days,
        // we should schedule for today (not for the day after the last one)
        // This prevents creating a backlog of missed instances
        if (nextDate < today) {
          nextDate = today
        }

        // Only create if nextDate is today or earlier (i.e., it's due)
        if (nextDate <= today) {
          newInstances.push({
            task_id: task.id,
            employee_id: employeeId,
            scheduled_date: nextDate,
            status: 'pending',
          })
        }
      }

      if (newInstances.length === 0) continue

      // 4. Insert new instances (ignore duplicates via unique constraint)
      const { data: inserted, error: insertError } = await supabaseAdmin
        .from('task_instances')
        .upsert(newInstances, {
          onConflict: 'task_id,employee_id,scheduled_date',
          ignoreDuplicates: true,
        })
        .select('id, employee_id, scheduled_date')

      if (insertError) {
        console.error(`[create-recurring-tasks] Error inserting instances for task ${task.id}:`, insertError.message)
        continue
      }

      if (inserted && inserted.length > 0) {
        totalCreated += inserted.length
        for (const inst of inserted) {
          details.push({
            task: task.title,
            employee_id: inst.employee_id,
            scheduled_date: inst.scheduled_date,
          })
        }
      }
    }

    // Log activity
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
          instances: details.slice(0, 50), // Limit logged details
        },
      })
    }

    console.log(`[create-recurring-tasks] Created ${totalCreated} recurring task instance(s) for ${today}`)

    return NextResponse.json({
      date: today,
      created: totalCreated,
      details: details,
    })
  } catch (err) {
    console.error('[create-recurring-tasks] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
