import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import {
  sendTaskAssignedEmail,
  sendTaskCompletedEmail,
} from '@/lib/email'
import {
  sendTaskAssignedSMS,
} from '@/lib/sms'
import { formatDateOnly, formatDateTime, formatTimeString, getTodayNY } from '@/lib/utils'
import { getEmployeeRecipient } from '@/lib/recipients'

type NotificationType = 'task_assigned' | 'task_completed'

interface NotifyRequest {
  taskInstanceId?: string
  taskId?: string
  employeeId?: string
  type: NotificationType
  notes?: string
}

export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body: NotifyRequest = await request.json()

    // Verify user is admin for task_assigned notifications
    if (body.type === 'task_assigned') {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      if ((profile as { role: string } | null)?.role !== 'admin') {
        return NextResponse.json({ error: 'Forbidden - Admin only' }, { status: 403 })
      }
    }
    const { taskInstanceId, taskId, employeeId, type, notes } = body

    if (!type) {
      return NextResponse.json({ error: 'Missing notification type' }, { status: 400 })
    }

    let result: { success: boolean; error?: string } = { success: false }

    if (type === 'task_assigned') {
      if (!taskInstanceId && (!taskId || !employeeId)) {
        return NextResponse.json({ error: 'Missing required fields for task assignment' }, { status: 400 })
      }

      // Get task instance + task; recipient is resolved centrally below
      let taskInstance
      let resolvedEmployeeId: string
      if (taskInstanceId) {
        const { data, error } = await supabase
          .from('task_instances')
          .select(`
            *,
            tasks (
              title,
              description,
              location,
              cutoff_time
            )
          `)
          .eq('id', taskInstanceId)
          .single()

        if (error || !data) {
          return NextResponse.json({ error: 'Task instance not found' }, { status: 404 })
        }
        taskInstance = data
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        resolvedEmployeeId = (data as any).employee_id
      } else {
        const { data: taskData, error: taskError } = await supabase
          .from('tasks')
          .select('*')
          .eq('id', taskId!)
          .single()

        if (taskError || !taskData) {
          return NextResponse.json({ error: 'Task not found' }, { status: 404 })
        }

        taskInstance = {
          tasks: taskData,
          scheduled_date: getTodayNY(),
        }
        resolvedEmployeeId = employeeId!
      }

      const recipient = await getEmployeeRecipient(resolvedEmployeeId)
      if (!recipient) {
        return NextResponse.json({ success: true, skipped: 'inactive_employee' })
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const taskInstanceData = taskInstance as any
      const task = taskInstanceData.tasks
      const employeeEmail = recipient.email
      const employeePhone = recipient.phoneNumber

      if (!employeeEmail) {
        return NextResponse.json({ error: 'Employee email not found' }, { status: 400 })
      }

      result = await sendTaskAssignedEmail({
        employeeName: recipient.displayName || recipient.fullName,
        employeeEmail,
        taskTitle: task.title,
        taskDescription: task.description || undefined,
        scheduledDate: formatDateOnly(taskInstanceData.scheduled_date),
        location: task.location || undefined,
      })

      // Send SMS only when we have a real task_instance.id, so every SMS
      // carries a unique deep link. The taskId+employeeId fallback synthesizes
      // an instance with no id — skip SMS there to avoid a non-unique URL.
      const resolvedInstanceId: string | undefined = taskInstanceId || taskInstanceData.id
      if (employeePhone && resolvedInstanceId) {
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://admin.playfunia.com'
        const taskUrl = `${baseUrl}/employee/tasks?taskId=${resolvedInstanceId}`

        sendTaskAssignedSMS({
          employeeName: recipient.displayName || recipient.fullName,
          employeePhone,
          taskTitle: task.title,
          scheduledDate: formatDateOnly(taskInstanceData.scheduled_date),
          cutoffTime: task.cutoff_time ? formatTimeString(task.cutoff_time) : undefined,
          location: task.location || undefined,
          taskDescription: task.description || undefined,
          taskUrl,
        }).catch(err => console.error('Failed to send task assigned SMS:', err))
      } else if (employeePhone && !resolvedInstanceId) {
        console.warn('[tasks/notify] Skipping SMS: no task_instance.id available for deep link')
      }

    } else if (type === 'task_completed') {
      if (!taskInstanceId) {
        return NextResponse.json({ error: 'Missing task instance ID' }, { status: 400 })
      }

      // Get completed task instance
      const { data: taskInstance, error } = await supabase
        .from('task_instances')
        .select(`
          *,
          tasks (
            title
          ),
          employees (
            display_name
          )
        `)
        .eq('id', taskInstanceId)
        .single()

      if (error || !taskInstance) {
        return NextResponse.json({ error: 'Task instance not found' }, { status: 404 })
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const taskInstanceData = taskInstance as any
      const task = taskInstanceData.tasks
      const employee = taskInstanceData.employees

      // Verify the requesting user owns this task instance or is an admin
      if (user.id !== taskInstanceData.employee_id) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .single()
        if ((profile as { role: string } | null)?.role !== 'admin') {
          return NextResponse.json({ error: 'Forbidden - Not your task' }, { status: 403 })
        }
      }

      result = await sendTaskCompletedEmail({
        employeeName: employee?.display_name || 'Employee',
        taskTitle: task?.title || 'Unknown Task',
        scheduledDate: formatDateOnly(taskInstanceData.scheduled_date),
        completedAt: formatDateTime(taskInstanceData.completed_at || new Date().toISOString()),
        notes: notes || taskInstanceData.notes || undefined,
      })

      // Create next recurring task instance if applicable (non-blocking)
      createNextRecurringInstance(
        taskInstanceData.task_id,
        taskInstanceData.employee_id,
        taskInstanceData.scheduled_date
      ).catch(err => console.error('Failed to create next recurring instance:', err))

    } else {
      return NextResponse.json({ error: 'Invalid notification type' }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      emailSent: result.success,
    })

  } catch (error) {
    console.error('Error sending task notification:', error)
    return NextResponse.json({
      error: 'Internal server error'
    }, { status: 500 })
  }
}

/**
 * After a recurring task instance is completed, create the next pending instance.
 * Uses service role client to bypass RLS.
 */
async function createNextRecurringInstance(
  taskId: string,
  employeeId: string,
  lastScheduledDate: string
) {
  const supabaseAdmin = createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Check if the task is recurring
  const { data: task, error: taskError } = await supabaseAdmin
    .from('tasks')
    .select('is_recurring, frequency, title')
    .eq('id', taskId)
    .single()

  if (taskError || !task || !task.is_recurring) return

  const frequency = task.frequency || 'daily'

  // Calculate next scheduled date based on the completed instance's date + interval
  const [y, m, d] = lastScheduledDate.split('-').map(Number)
  const nextDate = new Date(y, m - 1, d, 12, 0, 0)

  switch (frequency) {
    case 'daily':
      nextDate.setDate(nextDate.getDate() + 1)
      break
    case 'weekly':
      nextDate.setDate(nextDate.getDate() + 7)
      break
    case 'monthly':
      nextDate.setMonth(nextDate.getMonth() + 1)
      break
    default:
      nextDate.setDate(nextDate.getDate() + 1)
  }

  let nextDateStr = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`

  // Clamp to today (NY): the next instance must never land in the past. This stops
  // the date "drift" that occurs when tasks are completed late or in a backlog —
  // the next occurrence is always anchored to the real calendar, not the old date.
  const todayNY = getTodayNY()
  if (nextDateStr < todayNY) {
    nextDateStr = todayNY
  }

  // Don't pile up duplicates: if this employee already has an open (pending) instance
  // for this task, skip — they already have something to do for this recurring task.
  const { data: existingPending } = await supabaseAdmin
    .from('task_instances')
    .select('id')
    .eq('task_id', taskId)
    .eq('employee_id', employeeId)
    .eq('status', 'pending')
    .limit(1)

  if (existingPending && existingPending.length > 0) {
    return
  }

  // Create new instance (ignore if duplicate exists via unique constraint)
  const { error: insertError } = await supabaseAdmin
    .from('task_instances')
    .upsert(
      {
        task_id: taskId,
        employee_id: employeeId,
        scheduled_date: nextDateStr,
        status: 'pending',
      },
      { onConflict: 'task_id,employee_id,scheduled_date', ignoreDuplicates: true }
    )

  if (insertError) {
    console.error(`[recurring-task] Failed to create next instance for task ${taskId}:`, insertError.message)
  } else {
    console.log(`[recurring-task] Created next ${frequency} instance for "${task.title}" on ${nextDateStr}`)
  }
}
