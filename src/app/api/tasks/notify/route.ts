import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  sendTaskAssignedEmail,
  sendTaskCompletedEmail,
} from '@/lib/email'
import { formatDate, formatDateTime } from '@/lib/utils'

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
    const { taskInstanceId, taskId, employeeId, type, notes } = body

    if (!type) {
      return NextResponse.json({ error: 'Missing notification type' }, { status: 400 })
    }

    let result: { success: boolean; error?: string } = { success: false }

    if (type === 'task_assigned') {
      if (!taskInstanceId && (!taskId || !employeeId)) {
        return NextResponse.json({ error: 'Missing required fields for task assignment' }, { status: 400 })
      }

      // Get task instance with task and employee details
      let taskInstance
      if (taskInstanceId) {
        const { data, error } = await supabase
          .from('task_instances')
          .select(`
            *,
            tasks (
              title,
              description,
              location
            ),
            employees (
              id,
              display_name,
              profiles (
                email
              )
            )
          `)
          .eq('id', taskInstanceId)
          .single()

        if (error || !data) {
          return NextResponse.json({ error: 'Task instance not found' }, { status: 404 })
        }
        taskInstance = data
      } else {
        // Get task separately
        const { data: taskData, error: taskError } = await supabase
          .from('tasks')
          .select('*')
          .eq('id', taskId!)
          .single()

        if (taskError || !taskData) {
          return NextResponse.json({ error: 'Task not found' }, { status: 404 })
        }

        // Get employee separately
        const { data: empData, error: empError } = await supabase
          .from('employees')
          .select('*, profiles(email)')
          .eq('id', employeeId!)
          .single()

        if (empError || !empData) {
          return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
        }

        taskInstance = {
          tasks: taskData,
          employees: empData,
          scheduled_date: new Date().toISOString().split('T')[0],
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const taskInstanceData = taskInstance as any
      const task = taskInstanceData.tasks
      const employee = taskInstanceData.employees
      const employeeEmail = employee?.profiles?.email

      if (!employeeEmail) {
        return NextResponse.json({ error: 'Employee email not found' }, { status: 400 })
      }

      result = await sendTaskAssignedEmail({
        employeeName: employee.display_name || 'Employee',
        employeeEmail,
        taskTitle: task.title,
        taskDescription: task.description || undefined,
        scheduledDate: formatDate(taskInstanceData.scheduled_date),
        location: task.location || undefined,
      })

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

      result = await sendTaskCompletedEmail({
        employeeName: employee?.display_name || 'Employee',
        taskTitle: task?.title || 'Unknown Task',
        scheduledDate: formatDate(taskInstanceData.scheduled_date),
        completedAt: formatDateTime(taskInstanceData.completed_at || new Date().toISOString()),
        notes: notes || taskInstanceData.notes || undefined,
      })
    }

    return NextResponse.json({
      success: true,
      emailSent: result.success,
    })

  } catch (error) {
    console.error('Error sending task notification:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
