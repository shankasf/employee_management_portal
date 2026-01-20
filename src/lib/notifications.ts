/**
 * Client-side notification helpers for sending email notifications via API routes.
 */

// Schedule notification types
type ScheduleNotificationType =
  | 'schedule_assigned'
  | 'schedule_confirmed'
  | 'cancellation_requested'
  | 'cancellation_approved'
  | 'admin_cancelled'

// Task notification types
type TaskNotificationType = 'task_assigned' | 'task_completed'

// Event notification types
type EventNotificationType = 'event_assigned' | 'event_removed'

/**
 * Send a schedule notification email
 */
export async function notifySchedule(
  scheduleId: string,
  type: ScheduleNotificationType,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch('/api/schedules/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduleId, type, reason }),
    })

    const data = await response.json()
    return { success: data.success, error: data.error }
  } catch (error) {
    console.error('Failed to send schedule notification:', error)
    return { success: false, error: 'Failed to send notification' }
  }
}

/**
 * Send a task notification email
 */
export async function notifyTask(
  type: TaskNotificationType,
  options: {
    taskInstanceId?: string
    taskId?: string
    employeeId?: string
    notes?: string
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch('/api/tasks/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, ...options }),
    })

    const data = await response.json()
    return { success: data.success, error: data.error }
  } catch (error) {
    console.error('Failed to send task notification:', error)
    return { success: false, error: 'Failed to send notification' }
  }
}

/**
 * Send an event notification email
 */
export async function notifyEvent(
  eventId: string,
  employeeId: string,
  type: EventNotificationType,
  role?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch('/api/events/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId, employeeId, type, role }),
    })

    const data = await response.json()
    return { success: data.success, error: data.error }
  } catch (error) {
    console.error('Failed to send event notification:', error)
    return { success: false, error: 'Failed to send notification' }
  }
}

// Convenience functions for common notifications

/**
 * Send bulk schedule creation notification
 */
export async function notifyBulkSchedules(options: {
  employeeId: string
  employeeName: string
  scheduleCount: number
  startDate: string
  endDate: string
  days: string[]
  startTime: string
  endTime: string
}): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch('/api/schedules/bulk-notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    })

    const data = await response.json()
    return { success: data.success, error: data.error }
  } catch (error) {
    console.error('Failed to send bulk schedule notification:', error)
    return { success: false, error: 'Failed to send notification' }
  }
}

export const scheduleNotifications = {
  assigned: (scheduleId: string) => notifySchedule(scheduleId, 'schedule_assigned'),
  confirmed: (scheduleId: string) => notifySchedule(scheduleId, 'schedule_confirmed'),
  cancellationRequested: (scheduleId: string, reason: string) =>
    notifySchedule(scheduleId, 'cancellation_requested', reason),
  cancellationApproved: (scheduleId: string) => notifySchedule(scheduleId, 'cancellation_approved'),
  adminCancelled: (scheduleId: string, reason?: string) =>
    notifySchedule(scheduleId, 'admin_cancelled', reason),
  bulkCreated: notifyBulkSchedules,
}

export const taskNotifications = {
  assigned: (taskInstanceId: string) => notifyTask('task_assigned', { taskInstanceId }),
  assignedNew: (taskId: string, employeeId: string) =>
    notifyTask('task_assigned', { taskId, employeeId }),
  completed: (taskInstanceId: string, notes?: string) =>
    notifyTask('task_completed', { taskInstanceId, notes }),
}

export const eventNotifications = {
  assigned: (eventId: string, employeeId: string, role: string) =>
    notifyEvent(eventId, employeeId, 'event_assigned', role),
  removed: (eventId: string, employeeId: string) =>
    notifyEvent(eventId, employeeId, 'event_removed'),
}
