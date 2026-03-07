/**
 * SMS service using Twilio for sending notifications.
 * Mirrors the email notification system to provide SMS alongside emails.
 */

import twilio from 'twilio'
import { createServiceClient } from './supabase/server'

// Twilio configuration from environment variables
const accountSid = process.env.TWILIO_ACCOUNT_SID || ''
const authToken = process.env.TWILIO_AUTH_TOKEN || ''
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER || ''

// Initialize Twilio client (lazy initialization to avoid errors when env vars not set)
let twilioClient: twilio.Twilio | null = null

function getTwilioClient(): twilio.Twilio | null {
  if (!accountSid || !authToken) {
    console.warn('[SMS] Twilio credentials not configured')
    return null
  }
  if (!twilioClient) {
    twilioClient = twilio(accountSid, authToken)
  }
  return twilioClient
}

interface SendSMSOptions {
  to: string | string[]
  body: string
}

/**
 * Format phone number to E.164 format for Twilio
 * Assumes US numbers if no country code provided
 */
function formatPhoneNumber(phone: string): string | null {
  if (!phone) return null

  // Remove all non-digit characters except leading +
  let cleaned = phone.replace(/[^\d+]/g, '')

  // If it doesn't start with +, assume US number
  if (!cleaned.startsWith('+')) {
    // Remove leading 1 if present (for numbers like 11234567890)
    if (cleaned.startsWith('1') && cleaned.length === 11) {
      cleaned = cleaned.substring(1)
    }
    // Add US country code
    if (cleaned.length === 10) {
      cleaned = '+1' + cleaned
    }
  }

  // Validate E.164 format (should be + followed by 10-15 digits)
  if (/^\+\d{10,15}$/.test(cleaned)) {
    return cleaned
  }

  console.warn(`[SMS] Invalid phone number format: ${phone}`)
  return null
}

/**
 * Send an SMS using Twilio
 */
export async function sendSMS(options: SendSMSOptions): Promise<{ success: boolean; error?: string }> {
  const client = getTwilioClient()
  if (!client) {
    return { success: false, error: 'Twilio not configured' }
  }

  if (!twilioPhoneNumber) {
    return { success: false, error: 'Twilio phone number not configured' }
  }

  const recipients = Array.isArray(options.to) ? options.to : [options.to]
  const results: { success: boolean; phone: string; error?: string }[] = []

  for (const recipient of recipients) {
    const formattedPhone = formatPhoneNumber(recipient)
    if (!formattedPhone) {
      results.push({ success: false, phone: recipient, error: 'Invalid phone number' })
      continue
    }

    try {
      const message = await client.messages.create({
        body: options.body,
        from: twilioPhoneNumber,
        to: formattedPhone,
      })

      console.log(`[SMS] Message sent successfully: ${message.sid} to ${formattedPhone}`)
      results.push({ success: true, phone: formattedPhone })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      console.error(`[SMS] Failed to send to ${formattedPhone}:`, error)
      results.push({ success: false, phone: formattedPhone, error: errorMessage })
    }
  }

  const successCount = results.filter(r => r.success).length
  const failCount = results.filter(r => !r.success).length

  if (failCount === 0) {
    return { success: true }
  } else if (successCount === 0) {
    return { success: false, error: `All ${failCount} SMS failed to send` }
  } else {
    return { success: true, error: `${successCount} sent, ${failCount} failed` }
  }
}

/**
 * Get employee phone number by employee ID
 */
export async function getEmployeePhone(employeeId: string): Promise<string | null> {
  const supabase = await createServiceClient()
  const { data, error } = await supabase
    .from('employees')
    .select('phone_number')
    .eq('id', employeeId)
    .single()

  if (error || !data) {
    console.error('[SMS] Failed to fetch employee phone:', error)
    return null
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any).phone_number || null
}

/**
 * Get all admin/manager phone numbers from notification_recipients table
 * Note: This requires adding a phone_number field to notification_recipients table
 */
export async function getNotificationRecipientPhones(): Promise<string[]> {
  const supabase = await createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('notification_recipients')
    .select('phone_number')
    .eq('is_active', true)

  if (error) {
    console.error('[SMS] Failed to fetch notification recipient phones:', error)
    return []
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data?.map((r: any) => r.phone_number).filter(Boolean) || []
}

/**
 * Get all admin phone numbers from employees table (admins who also have employee records)
 */
export async function getAdminPhones(): Promise<string[]> {
  const supabase = await createServiceClient()
  const { data, error } = await supabase
    .from('profiles')
    .select('id, role, status')
    .eq('role', 'admin')
    .eq('status', 'active')

  if (error || !data) {
    console.error('[SMS] Failed to fetch admin profiles:', error)
    return []
  }

  // Get phone numbers from employees table for these admin profiles
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminIds = (data as any[]).map((p: any) => p.id)
  if (adminIds.length === 0) return []

  const { data: employeeData, error: empError } = await supabase
    .from('employees')
    .select('phone_number')
    .in('id', adminIds)

  if (empError) {
    console.error('[SMS] Failed to fetch admin employee phones:', empError)
    return []
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (employeeData as any[])?.map((e: any) => e.phone_number).filter(Boolean) || []
}

/**
 * Get all notification recipient phone numbers including:
 * - Admin accounts from profiles/employees table
 * - Custom notification recipients from notification_recipients table
 */
export async function getAllNotificationRecipientPhones(): Promise<string[]> {
  const [recipientPhones, adminPhones] = await Promise.all([
    getNotificationRecipientPhones(),
    getAdminPhones()
  ])

  // Deduplicate
  const allPhones = new Set<string>([...recipientPhones, ...adminPhones])
  return Array.from(allPhones).filter(Boolean)
}

// ============================================
// SMS MESSAGE TEMPLATES
// ============================================

// ============================================
// WELCOME SMS
// ============================================

interface WelcomeSMSData {
  employeeName: string
  phone: string
  tempPassword: string
}

export async function sendWelcomeSMS(data: WelcomeSMSData): Promise<{ success: boolean; error?: string }> {
  const body = `Welcome to PlayFunia, ${data.employeeName}! Your account is ready. Temp password: ${data.tempPassword}. Please login and change it immediately at admin.playfunia.com/login`

  return sendSMS({
    to: data.phone,
    body,
  })
}

// ============================================
// SCHEDULE SMS
// ============================================

interface ScheduleSMSData {
  employeeName: string
  employeePhone: string
  scheduleDate: string
  startTime: string
  endTime: string
  notes?: string
}

export async function sendScheduleAssignedSMS(data: ScheduleSMSData): Promise<{ success: boolean; error?: string }> {
  // Send to employee
  const employeeBody = `Hi ${data.employeeName}, you've been assigned a new schedule: ${data.scheduleDate} from ${data.startTime}-${data.endTime}.${data.notes ? ` Notes: ${data.notes}` : ''} Please confirm in the portal.`

  const employeeResult = await sendSMS({
    to: data.employeePhone,
    body: employeeBody,
  })

  // Notify admins
  const adminPhones = await getAllNotificationRecipientPhones()
  if (adminPhones.length > 0) {
    const adminBody = `Schedule Assigned: ${data.employeeName} on ${data.scheduleDate} (${data.startTime}-${data.endTime})`
    await sendSMS({
      to: adminPhones,
      body: adminBody,
    })
  }

  return employeeResult
}

interface ScheduleConfirmedSMSData {
  employeeName: string
  employeePhone: string
  scheduleDate: string
  startTime: string
  endTime: string
}

export async function sendScheduleConfirmedSMS(data: ScheduleConfirmedSMSData): Promise<{ success: boolean; error?: string }> {
  // Send to employee
  const employeeBody = `Hi ${data.employeeName}, your schedule for ${data.scheduleDate} (${data.startTime}-${data.endTime}) has been confirmed. See you then!`

  const employeeResult = await sendSMS({
    to: data.employeePhone,
    body: employeeBody,
  })

  // Notify admins
  const adminPhones = await getAllNotificationRecipientPhones()
  if (adminPhones.length > 0) {
    const adminBody = `Schedule Confirmed: ${data.employeeName} confirmed ${data.scheduleDate} (${data.startTime}-${data.endTime})`
    await sendSMS({
      to: adminPhones,
      body: adminBody,
    })
  }

  return employeeResult
}

interface CancellationRequestSMSData {
  employeeName: string
  scheduleDate: string
  startTime: string
  endTime: string
  reason: string
}

export async function sendCancellationRequestSMS(data: CancellationRequestSMSData): Promise<{ success: boolean; error?: string }> {
  const adminPhones = await getAllNotificationRecipientPhones()
  if (adminPhones.length === 0) return { success: true }

  const body = `Cancellation Request: ${data.employeeName} requests to cancel ${data.scheduleDate} (${data.startTime}-${data.endTime}). Reason: ${data.reason}`

  return sendSMS({
    to: adminPhones,
    body,
  })
}

interface CancellationApprovedSMSData {
  employeeName: string
  employeePhone: string
  scheduleDate: string
  startTime: string
  endTime: string
}

export async function sendCancellationApprovedSMS(data: CancellationApprovedSMSData): Promise<{ success: boolean; error?: string }> {
  // Send to employee
  const employeeBody = `Hi ${data.employeeName}, your cancellation request for ${data.scheduleDate} (${data.startTime}-${data.endTime}) has been approved. You are no longer scheduled.`

  const employeeResult = await sendSMS({
    to: data.employeePhone,
    body: employeeBody,
  })

  // Notify admins
  const adminPhones = await getAllNotificationRecipientPhones()
  if (adminPhones.length > 0) {
    const adminBody = `Schedule Cancelled: ${data.employeeName}'s cancellation approved for ${data.scheduleDate}`
    await sendSMS({
      to: adminPhones,
      body: adminBody,
    })
  }

  return employeeResult
}

interface AdminCancelledSMSData {
  employeeName: string
  employeePhone: string
  scheduleDate: string
  startTime: string
  endTime: string
  reason?: string
}

export async function sendAdminCancelledSMS(data: AdminCancelledSMSData): Promise<{ success: boolean; error?: string }> {
  // Send to employee
  const employeeBody = `Hi ${data.employeeName}, your schedule for ${data.scheduleDate} (${data.startTime}-${data.endTime}) has been cancelled by management.${data.reason ? ` Reason: ${data.reason}` : ''}`

  const employeeResult = await sendSMS({
    to: data.employeePhone,
    body: employeeBody,
  })

  // Notify admins
  const adminPhones = await getAllNotificationRecipientPhones()
  if (adminPhones.length > 0) {
    const adminBody = `Schedule Cancelled by Admin: ${data.employeeName} on ${data.scheduleDate}`
    await sendSMS({
      to: adminPhones,
      body: adminBody,
    })
  }

  return employeeResult
}

interface ScheduleDeletedSMSData {
  employeeName: string
  employeePhone: string
  scheduleDate: string
  startTime: string
  endTime: string
  reason?: string
}

export async function sendScheduleDeletedSMS(data: ScheduleDeletedSMSData): Promise<{ success: boolean; error?: string }> {
  // Send to employee
  const employeeBody = `Hi ${data.employeeName}, your schedule for ${data.scheduleDate} (${data.startTime}-${data.endTime}) has been deleted.${data.reason ? ` Reason: ${data.reason}` : ''} Contact your manager if you have questions.`

  const employeeResult = await sendSMS({
    to: data.employeePhone,
    body: employeeBody,
  })

  // Notify admins
  const adminPhones = await getAllNotificationRecipientPhones()
  if (adminPhones.length > 0) {
    const adminBody = `Schedule Deleted: ${data.employeeName}'s schedule for ${data.scheduleDate} removed`
    await sendSMS({
      to: adminPhones,
      body: adminBody,
    })
  }

  return employeeResult
}

// ============================================
// TASK SMS
// ============================================

interface TaskAssignedSMSData {
  employeeName: string
  employeePhone: string
  taskTitle: string
  scheduledDate: string
  location?: string
}

export async function sendTaskAssignedSMS(data: TaskAssignedSMSData): Promise<{ success: boolean; error?: string }> {
  // Send to employee
  const employeeBody = `Hi ${data.employeeName}, new task assigned: "${data.taskTitle}" on ${data.scheduledDate}${data.location ? ` at ${data.location}` : ''}. Check the portal for details.`

  const employeeResult = await sendSMS({
    to: data.employeePhone,
    body: employeeBody,
  })

  // Notify admins
  const adminPhones = await getAllNotificationRecipientPhones()
  if (adminPhones.length > 0) {
    const adminBody = `Task Assigned: "${data.taskTitle}" to ${data.employeeName} for ${data.scheduledDate}`
    await sendSMS({
      to: adminPhones,
      body: adminBody,
    })
  }

  return employeeResult
}

interface TaskCompletedSMSData {
  employeeName: string
  taskTitle: string
  scheduledDate: string
  completedAt: string
}

export async function sendTaskCompletedSMS(data: TaskCompletedSMSData): Promise<{ success: boolean; error?: string }> {
  const adminPhones = await getAllNotificationRecipientPhones()
  if (adminPhones.length === 0) return { success: true }

  const body = `Task Completed: ${data.employeeName} completed "${data.taskTitle}" at ${data.completedAt}`

  return sendSMS({
    to: adminPhones,
    body,
  })
}

// ============================================
// TASK DEADLINE REMINDER SMS
// ============================================

interface TaskDeadlineReminderSMSData {
  employeeName: string
  employeePhone: string
  taskTitle: string
  cutoffTime: string
}

export async function sendTaskDeadlineReminderSMS(data: TaskDeadlineReminderSMSData): Promise<{ success: boolean; error?: string }> {
  const body = `Hi ${data.employeeName}, reminder: your task "${data.taskTitle}" is due at ${data.cutoffTime}. Please complete it before the deadline.`

  return sendSMS({
    to: data.employeePhone,
    body,
  })
}

// ============================================
// EVENT SMS
// ============================================

interface EventAssignedSMSData {
  employeeName: string
  employeePhone: string
  eventTitle: string
  eventDate: string
  eventTime: string
  room?: string
  role: string
}

export async function sendEventAssignedSMS(data: EventAssignedSMSData): Promise<{ success: boolean; error?: string }> {
  // Send to employee
  const employeeBody = `Hi ${data.employeeName}, you're assigned to event "${data.eventTitle}" on ${data.eventDate} at ${data.eventTime}${data.room ? ` in ${data.room}` : ''}. Role: ${data.role}`

  const employeeResult = await sendSMS({
    to: data.employeePhone,
    body: employeeBody,
  })

  // Notify admins
  const adminPhones = await getAllNotificationRecipientPhones()
  if (adminPhones.length > 0) {
    const adminBody = `Event Assignment: ${data.employeeName} assigned to "${data.eventTitle}" (${data.eventDate})`
    await sendSMS({
      to: adminPhones,
      body: adminBody,
    })
  }

  return employeeResult
}

interface EventRemovedSMSData {
  employeeName: string
  employeePhone: string
  eventTitle: string
  eventDate: string
}

export async function sendEventRemovedSMS(data: EventRemovedSMSData): Promise<{ success: boolean; error?: string }> {
  // Send to employee
  const employeeBody = `Hi ${data.employeeName}, you've been removed from event "${data.eventTitle}" on ${data.eventDate}. Contact your manager if you have questions.`

  const employeeResult = await sendSMS({
    to: data.employeePhone,
    body: employeeBody,
  })

  // Notify admins
  const adminPhones = await getAllNotificationRecipientPhones()
  if (adminPhones.length > 0) {
    const adminBody = `Event Removal: ${data.employeeName} removed from "${data.eventTitle}" (${data.eventDate})`
    await sendSMS({
      to: adminPhones,
      body: adminBody,
    })
  }

  return employeeResult
}

// ============================================
// EMPLOYEE MANAGEMENT SMS
// ============================================

interface EmployeeDeactivatedSMSData {
  employeeName: string
}

export async function sendEmployeeDeactivatedSMS(data: EmployeeDeactivatedSMSData): Promise<{ success: boolean; error?: string }> {
  const adminPhones = await getAllNotificationRecipientPhones()
  if (adminPhones.length === 0) return { success: true }

  const body = `Employee Deactivated: ${data.employeeName}'s account has been deactivated.`

  return sendSMS({
    to: adminPhones,
    body,
  })
}

interface EmployeeDeletedSMSData {
  employeeName: string
  email: string
  phone?: string
}

export async function sendEmployeeDeletedSMS(data: EmployeeDeletedSMSData): Promise<{ success: boolean; error?: string }> {
  // Try to send to employee if they have a phone
  if (data.phone) {
    await sendSMS({
      to: data.phone,
      body: `Hi ${data.employeeName}, your PlayFunia employee account has been removed. Thank you for your time with us.`,
    }).catch(err => console.warn('[SMS] Could not send deletion SMS to employee:', err))
  }

  // Notify admins
  const adminPhones = await getAllNotificationRecipientPhones()
  if (adminPhones.length > 0) {
    return sendSMS({
      to: adminPhones,
      body: `Employee Deleted: ${data.employeeName} (${data.email}) has been permanently removed from the system.`,
    })
  }

  return { success: true }
}

interface EmployeeCreatedSMSData {
  employeeName: string
  email: string
  position?: string
}

export async function sendEmployeeCreatedSMS(data: EmployeeCreatedSMSData): Promise<{ success: boolean; error?: string }> {
  const adminPhones = await getAllNotificationRecipientPhones()
  if (adminPhones.length === 0) return { success: true }

  const body = `New Employee: ${data.employeeName} (${data.email})${data.position ? ` - ${data.position}` : ''} has been added to the system.`

  return sendSMS({
    to: adminPhones,
    body,
  })
}

// ============================================
// BULK SCHEDULE SMS
// ============================================

interface BulkSchedulesCreatedSMSData {
  employeeName: string
  scheduleCount: number
  startDate: string
  endDate: string
}

export async function sendBulkSchedulesCreatedSMS(data: BulkSchedulesCreatedSMSData): Promise<{ success: boolean; error?: string }> {
  const adminPhones = await getAllNotificationRecipientPhones()
  if (adminPhones.length === 0) return { success: true }

  const body = `Bulk Schedules: ${data.scheduleCount} schedules created for ${data.employeeName} from ${data.startDate} to ${data.endDate}`

  return sendSMS({
    to: adminPhones,
    body,
  })
}

// ============================================
// PASSWORD RESET SMS
// ============================================

interface PasswordResetSMSData {
  name: string
  phone: string
  resetUrl: string
}

export async function sendPasswordResetSMS(data: PasswordResetSMSData): Promise<{ success: boolean; error?: string }> {
  const body = `Hi ${data.name}, reset your PlayFunia password here: ${data.resetUrl} (expires in 1 hour). If you didn't request this, ignore this message.`

  return sendSMS({
    to: data.phone,
    body,
  })
}

// ============================================
// POLICY SMS
// ============================================

interface PolicySMSData {
  employeeName: string
  employeePhone: string
  policyTitle: string
}

export async function sendPolicySMS(data: PolicySMSData): Promise<{ success: boolean; error?: string }> {
  const employeeBody = `Hi ${data.employeeName}, please review the company policy "${data.policyTitle}" that was sent to your email. Log in to the portal for details.`

  const employeeResult = await sendSMS({
    to: data.employeePhone,
    body: employeeBody,
  })

  // Notify admins
  const adminPhones = await getAllNotificationRecipientPhones()
  if (adminPhones.length > 0) {
    const adminBody = `Policy Sent: "${data.policyTitle}" sent to ${data.employeeName}`
    await sendSMS({
      to: adminPhones,
      body: adminBody,
    })
  }

  return employeeResult
}
