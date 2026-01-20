/**
 * Email service using AWS SES SMTP for sending notifications.
 * This replaces Supabase email functionality with direct SMTP sending.
 */

import nodemailer from 'nodemailer'
import { createServiceClient } from './supabase/server'

// Email configuration from environment variables
const emailConfig = {
  host: process.env.SMTP_HOST || 'email-smtp.us-east-1.amazonaws.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
}

const fromEmail = process.env.SMTP_FROM || 'noreply@playfunia.com'
const fromName = process.env.SMTP_FROM_NAME || 'PlayFunia Employee Portal'

// Admin email - always receives notifications
const ADMIN_EMAIL = process.env.ADMIN_NOTIFICATION_EMAIL || 'playfunia@playfunia.com'

// Create reusable transporter
const transporter = nodemailer.createTransport(emailConfig)

// Email types
export type EmailType =
  | 'welcome'
  | 'password_reset'
  | 'schedule_assigned'
  | 'schedule_confirmed'
  | 'schedule_cancellation_requested'
  | 'schedule_cancellation_approved'
  | 'schedule_cancelled_by_admin'
  | 'task_assigned'
  | 'task_completed'
  | 'event_assigned'
  | 'event_removed'

interface SendEmailOptions {
  to: string | string[]
  subject: string
  html: string
  text?: string
}

/**
 * Send an email using AWS SES SMTP
 */
export async function sendEmail(options: SendEmailOptions): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
      subject: options.subject,
      html: options.html,
      text: options.text || options.html.replace(/<[^>]*>/g, ''),
    })

    console.log('Email sent successfully:', result.messageId)
    return { success: true }
  } catch (error) {
    console.error('Failed to send email:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

/**
 * Get all notification recipients (managers/owners) from database
 */
export async function getNotificationRecipients(): Promise<string[]> {
  const supabase = await createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('notification_recipients')
    .select('email')
    .eq('is_active', true)

  if (error) {
    console.error('Failed to fetch notification recipients:', error)
    return []
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data?.map((r: any) => r.email) || []
}

/**
 * Get all admin emails from profiles table
 */
export async function getAdminEmails(): Promise<string[]> {
  const supabase = await createServiceClient()
  const { data, error } = await supabase
    .from('profiles')
    .select('email')
    .eq('role', 'admin')
    .eq('status', 'active')

  if (error) {
    console.error('Failed to fetch admin emails:', error)
    return []
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data?.map((r: any) => r.email).filter(Boolean) || []
}

/**
 * Get all notification recipients including:
 * - Default admin email (ADMIN_NOTIFICATION_EMAIL)
 * - All admin accounts from profiles table
 * - Custom notification recipients from notification_recipients table
 * This ensures all admins receive important notifications
 */
export async function getAllNotificationRecipients(): Promise<string[]> {
  // Fetch custom recipients and admin emails in parallel
  const [customRecipients, adminEmails] = await Promise.all([
    getNotificationRecipients(),
    getAdminEmails()
  ])

  // Combine all recipients and deduplicate
  const allRecipients = new Set<string>([
    ADMIN_EMAIL,
    ...customRecipients,
    ...adminEmails
  ])

  return Array.from(allRecipients).filter(Boolean)
}

/**
 * Get employee email by employee ID
 */
export async function getEmployeeEmail(employeeId: string): Promise<string | null> {
  const supabase = await createServiceClient()
  const { data, error } = await supabase
    .from('employees')
    .select('profiles(email)')
    .eq('id', employeeId)
    .single()

  if (error || !data) {
    console.error('Failed to fetch employee email:', error)
    return null
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any).profiles?.email || null
}

// ============================================
// EMAIL TEMPLATES
// ============================================

const baseStyles = `
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; }
  .container { max-width: 600px; margin: 0 auto; padding: 20px; }
  .header { background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
  .header h1 { margin: 0; font-size: 24px; }
  .content { background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; }
  .footer { background: #1f2937; color: #9ca3af; padding: 20px; text-align: center; font-size: 12px; border-radius: 0 0 8px 8px; }
  .button { display: inline-block; background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 10px 0; }
  .info-box { background: white; border: 1px solid #e5e7eb; border-radius: 6px; padding: 15px; margin: 15px 0; }
  .label { color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
  .value { font-size: 16px; font-weight: 600; color: #111827; }
`

function wrapInTemplate(content: string): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>${baseStyles}</style>
    </head>
    <body>
      <div class="container">
        ${content}
        <div class="footer">
          <p>PlayFunia Employee Portal</p>
          <p>This is an automated message. Please do not reply to this email.</p>
        </div>
      </div>
    </body>
    </html>
  `
}

// ============================================
// WELCOME EMAIL
// ============================================

interface WelcomeEmailData {
  employeeName: string
  email: string
  tempPassword: string
  portalUrl?: string
}

export async function sendWelcomeEmail(data: WelcomeEmailData): Promise<{ success: boolean; error?: string }> {
  const loginUrl = data.portalUrl || 'https://admin.playfunia.com/login'

  const html = wrapInTemplate(`
    <div class="header">
      <h1>Welcome to PlayFunia!</h1>
    </div>
    <div class="content">
      <p>Hi ${data.employeeName},</p>
      <p>Welcome to the PlayFunia team! Your employee account has been created.</p>

      <div class="info-box">
        <p class="label">Your Login Credentials</p>
        <p><strong>Email:</strong> ${data.email}</p>
        <p><strong>Temporary Password:</strong> ${data.tempPassword}</p>
      </div>

      <p>Please log in and change your password as soon as possible.</p>

      <p style="text-align: center;">
        <a href="${loginUrl}" class="button">Login to Portal</a>
      </p>

      <p style="color: #6b7280; font-size: 14px;">
        If you have any questions, please contact your manager.
      </p>
    </div>
  `)

  return sendEmail({
    to: data.email,
    subject: 'Welcome to PlayFunia - Your Account Details',
    html,
  })
}

// ============================================
// SCHEDULE EMAILS
// ============================================

interface ScheduleEmailData {
  employeeName: string
  employeeEmail: string
  scheduleDate: string
  startTime: string
  endTime: string
  notes?: string
}

export async function sendScheduleAssignedEmail(data: ScheduleEmailData): Promise<{ success: boolean; error?: string }> {
  // Send to employee
  const employeeHtml = wrapInTemplate(`
    <div class="header">
      <h1>New Schedule Assigned</h1>
    </div>
    <div class="content">
      <p>Hi ${data.employeeName},</p>
      <p>You have been assigned a new work schedule.</p>

      <div class="info-box">
        <p class="label">Schedule Details</p>
        <p><strong>Date:</strong> ${data.scheduleDate}</p>
        <p><strong>Time:</strong> ${data.startTime} - ${data.endTime}</p>
        ${data.notes ? `<p><strong>Notes:</strong> ${data.notes}</p>` : ''}
      </div>

      <p>Please log in to the portal to confirm your schedule.</p>

      <p style="text-align: center;">
        <a href="https://admin.playfunia.com/employee/schedules" class="button">View Schedule</a>
      </p>
    </div>
  `)

  const employeeResult = await sendEmail({
    to: data.employeeEmail,
    subject: `New Schedule Assigned - ${data.scheduleDate}`,
    html: employeeHtml,
  })

  // Also notify admin and managers
  const recipients = await getAllNotificationRecipients()
  if (recipients.length > 0) {
    const adminHtml = wrapInTemplate(`
      <div class="header">
        <h1>Schedule Assigned</h1>
      </div>
      <div class="content">
        <p>A new schedule has been assigned to an employee.</p>

        <div class="info-box">
          <p class="label">Schedule Details</p>
          <p><strong>Employee:</strong> ${data.employeeName}</p>
          <p><strong>Date:</strong> ${data.scheduleDate}</p>
          <p><strong>Time:</strong> ${data.startTime} - ${data.endTime}</p>
          ${data.notes ? `<p><strong>Notes:</strong> ${data.notes}</p>` : ''}
        </div>

        <p style="text-align: center;">
          <a href="https://admin.playfunia.com/admin/schedules" class="button">View Schedules</a>
        </p>
      </div>
    `)

    await sendEmail({
      to: recipients,
      subject: `Schedule Assigned - ${data.employeeName} (${data.scheduleDate})`,
      html: adminHtml,
    })
  }

  return employeeResult
}

interface ScheduleConfirmedEmailData {
  employeeName: string
  employeeEmail: string
  scheduleDate: string
  startTime: string
  endTime: string
}

export async function sendScheduleConfirmedEmail(data: ScheduleConfirmedEmailData): Promise<{ success: boolean; error?: string }> {
  // Send confirmation to the employee
  const employeeHtml = wrapInTemplate(`
    <div class="header" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%);">
      <h1>Schedule Confirmed</h1>
    </div>
    <div class="content">
      <p>Hi ${data.employeeName},</p>
      <p>Your schedule has been confirmed successfully.</p>

      <div class="info-box">
        <p class="label">Confirmed Schedule</p>
        <p><strong>Date:</strong> ${data.scheduleDate}</p>
        <p><strong>Time:</strong> ${data.startTime} - ${data.endTime}</p>
      </div>

      <p>Thank you for confirming. Please arrive on time for your shift.</p>

      <p style="text-align: center;">
        <a href="https://admin.playfunia.com/employee/schedules" class="button">View My Schedules</a>
      </p>
    </div>
  `)

  const employeeResult = await sendEmail({
    to: data.employeeEmail,
    subject: `Schedule Confirmed - ${data.scheduleDate}`,
    html: employeeHtml,
  })

  // Send notification to all admins
  const recipients = await getAllNotificationRecipients()
  if (recipients.length > 0) {
    const adminHtml = wrapInTemplate(`
      <div class="header">
        <h1>Schedule Confirmed</h1>
      </div>
      <div class="content">
        <p>An employee has confirmed their schedule.</p>

        <div class="info-box">
          <p class="label">Confirmation Details</p>
          <p><strong>Employee:</strong> ${data.employeeName}</p>
          <p><strong>Date:</strong> ${data.scheduleDate}</p>
          <p><strong>Time:</strong> ${data.startTime} - ${data.endTime}</p>
        </div>

        <p style="text-align: center;">
          <a href="https://admin.playfunia.com/admin/schedules" class="button">View Schedules</a>
        </p>
      </div>
    `)

    await sendEmail({
      to: recipients,
      subject: `Schedule Confirmed - ${data.employeeName} (${data.scheduleDate})`,
      html: adminHtml,
    })
  }

  return employeeResult
}

interface CancellationRequestEmailData {
  employeeName: string
  scheduleDate: string
  startTime: string
  endTime: string
  reason: string
}

export async function sendCancellationRequestEmail(data: CancellationRequestEmailData): Promise<{ success: boolean; error?: string }> {
  const recipients = await getAllNotificationRecipients()
  if (recipients.length === 0) return { success: true }

  const html = wrapInTemplate(`
    <div class="header" style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);">
      <h1>Cancellation Request</h1>
    </div>
    <div class="content">
      <p>An employee has requested to cancel their schedule.</p>

      <div class="info-box">
        <p class="label">Request Details</p>
        <p><strong>Employee:</strong> ${data.employeeName}</p>
        <p><strong>Date:</strong> ${data.scheduleDate}</p>
        <p><strong>Time:</strong> ${data.startTime} - ${data.endTime}</p>
        <p><strong>Reason:</strong> ${data.reason}</p>
      </div>

      <p>Please review and approve or deny this request.</p>

      <p style="text-align: center;">
        <a href="https://admin.playfunia.com/admin/schedules" class="button">Review Request</a>
      </p>
    </div>
  `)

  return sendEmail({
    to: recipients,
    subject: `Cancellation Request - ${data.employeeName} (${data.scheduleDate})`,
    html,
  })
}

interface CancellationApprovedEmailData {
  employeeName: string
  employeeEmail: string
  scheduleDate: string
  startTime: string
  endTime: string
}

export async function sendCancellationApprovedEmail(data: CancellationApprovedEmailData): Promise<{ success: boolean; error?: string }> {
  const html = wrapInTemplate(`
    <div class="header" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%);">
      <h1>Cancellation Approved</h1>
    </div>
    <div class="content">
      <p>Hi ${data.employeeName},</p>
      <p>Your schedule cancellation request has been approved.</p>

      <div class="info-box">
        <p class="label">Cancelled Schedule</p>
        <p><strong>Date:</strong> ${data.scheduleDate}</p>
        <p><strong>Time:</strong> ${data.startTime} - ${data.endTime}</p>
      </div>

      <p>You are no longer scheduled to work on this date.</p>
    </div>
  `)

  // Send to employee
  const employeeResult = await sendEmail({
    to: data.employeeEmail,
    subject: `Schedule Cancellation Approved - ${data.scheduleDate}`,
    html,
  })

  // Also notify admin and managers
  const recipients = await getAllNotificationRecipients()
  if (recipients.length > 0) {
    await sendEmail({
      to: recipients,
      subject: `Schedule Cancelled - ${data.employeeName} (${data.scheduleDate})`,
      html: wrapInTemplate(`
        <div class="header" style="background: linear-gradient(135deg, #6b7280 0%, #4b5563 100%);">
          <h1>Schedule Cancelled</h1>
        </div>
        <div class="content">
          <p>A schedule cancellation has been approved.</p>

          <div class="info-box">
            <p class="label">Details</p>
            <p><strong>Employee:</strong> ${data.employeeName}</p>
            <p><strong>Date:</strong> ${data.scheduleDate}</p>
            <p><strong>Time:</strong> ${data.startTime} - ${data.endTime}</p>
          </div>
        </div>
      `),
    })
  }

  return employeeResult
}

interface AdminCancelledEmailData {
  employeeName: string
  employeeEmail: string
  scheduleDate: string
  startTime: string
  endTime: string
  reason?: string
}

export async function sendAdminCancelledEmail(data: AdminCancelledEmailData): Promise<{ success: boolean; error?: string }> {
  // Send to employee
  const employeeHtml = wrapInTemplate(`
    <div class="header" style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);">
      <h1>Schedule Cancelled</h1>
    </div>
    <div class="content">
      <p>Hi ${data.employeeName},</p>
      <p>Your schedule has been cancelled by management.</p>

      <div class="info-box">
        <p class="label">Cancelled Schedule</p>
        <p><strong>Date:</strong> ${data.scheduleDate}</p>
        <p><strong>Time:</strong> ${data.startTime} - ${data.endTime}</p>
        ${data.reason ? `<p><strong>Reason:</strong> ${data.reason}</p>` : ''}
      </div>

      <p>If you have any questions, please contact your manager.</p>
    </div>
  `)

  const employeeResult = await sendEmail({
    to: data.employeeEmail,
    subject: `Schedule Cancelled - ${data.scheduleDate}`,
    html: employeeHtml,
  })

  // Also notify admin and managers
  const recipients = await getAllNotificationRecipients()
  if (recipients.length > 0) {
    const adminHtml = wrapInTemplate(`
      <div class="header" style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);">
        <h1>Schedule Cancelled by Admin</h1>
      </div>
      <div class="content">
        <p>A schedule has been cancelled by management.</p>

        <div class="info-box">
          <p class="label">Cancelled Schedule</p>
          <p><strong>Employee:</strong> ${data.employeeName}</p>
          <p><strong>Date:</strong> ${data.scheduleDate}</p>
          <p><strong>Time:</strong> ${data.startTime} - ${data.endTime}</p>
          ${data.reason ? `<p><strong>Reason:</strong> ${data.reason}</p>` : ''}
        </div>

        <p style="text-align: center;">
          <a href="https://admin.playfunia.com/admin/schedules" class="button">View Schedules</a>
        </p>
      </div>
    `)

    await sendEmail({
      to: recipients,
      subject: `Schedule Cancelled - ${data.employeeName} (${data.scheduleDate})`,
      html: adminHtml,
    })
  }

  return employeeResult
}

// ============================================
// TASK EMAILS
// ============================================

interface TaskAssignedEmailData {
  employeeName: string
  employeeEmail: string
  taskTitle: string
  taskDescription?: string
  scheduledDate: string
  location?: string
}

export async function sendTaskAssignedEmail(data: TaskAssignedEmailData): Promise<{ success: boolean; error?: string }> {
  // Send to employee
  const employeeHtml = wrapInTemplate(`
    <div class="header">
      <h1>New Task Assigned</h1>
    </div>
    <div class="content">
      <p>Hi ${data.employeeName},</p>
      <p>You have been assigned a new task.</p>

      <div class="info-box">
        <p class="label">Task Details</p>
        <p><strong>Task:</strong> ${data.taskTitle}</p>
        ${data.taskDescription ? `<p><strong>Description:</strong> ${data.taskDescription}</p>` : ''}
        <p><strong>Date:</strong> ${data.scheduledDate}</p>
        ${data.location ? `<p><strong>Location:</strong> ${data.location}</p>` : ''}
      </div>

      <p style="text-align: center;">
        <a href="https://admin.playfunia.com/employee/tasks" class="button">View Tasks</a>
      </p>
    </div>
  `)

  const employeeResult = await sendEmail({
    to: data.employeeEmail,
    subject: `New Task Assigned - ${data.taskTitle}`,
    html: employeeHtml,
  })

  // Also notify admin and managers
  const recipients = await getAllNotificationRecipients()
  if (recipients.length > 0) {
    const adminHtml = wrapInTemplate(`
      <div class="header">
        <h1>Task Assigned</h1>
      </div>
      <div class="content">
        <p>A new task has been assigned to an employee.</p>

        <div class="info-box">
          <p class="label">Task Details</p>
          <p><strong>Employee:</strong> ${data.employeeName}</p>
          <p><strong>Task:</strong> ${data.taskTitle}</p>
          ${data.taskDescription ? `<p><strong>Description:</strong> ${data.taskDescription}</p>` : ''}
          <p><strong>Date:</strong> ${data.scheduledDate}</p>
          ${data.location ? `<p><strong>Location:</strong> ${data.location}</p>` : ''}
        </div>

        <p style="text-align: center;">
          <a href="https://admin.playfunia.com/admin/tasks" class="button">View Tasks</a>
        </p>
      </div>
    `)

    await sendEmail({
      to: recipients,
      subject: `Task Assigned - ${data.employeeName} (${data.taskTitle})`,
      html: adminHtml,
    })
  }

  return employeeResult
}

interface TaskCompletedEmailData {
  employeeName: string
  taskTitle: string
  scheduledDate: string
  completedAt: string
  notes?: string
}

export async function sendTaskCompletedEmail(data: TaskCompletedEmailData): Promise<{ success: boolean; error?: string }> {
  const recipients = await getAllNotificationRecipients()
  if (recipients.length === 0) return { success: true }

  const html = wrapInTemplate(`
    <div class="header" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%);">
      <h1>Task Completed</h1>
    </div>
    <div class="content">
      <p>An employee has completed a task.</p>

      <div class="info-box">
        <p class="label">Completion Details</p>
        <p><strong>Employee:</strong> ${data.employeeName}</p>
        <p><strong>Task:</strong> ${data.taskTitle}</p>
        <p><strong>Scheduled Date:</strong> ${data.scheduledDate}</p>
        <p><strong>Completed At:</strong> ${data.completedAt}</p>
        ${data.notes ? `<p><strong>Notes:</strong> ${data.notes}</p>` : ''}
      </div>

      <p style="text-align: center;">
        <a href="https://admin.playfunia.com/admin/tasks" class="button">View Tasks</a>
      </p>
    </div>
  `)

  return sendEmail({
    to: recipients,
    subject: `Task Completed - ${data.taskTitle} by ${data.employeeName}`,
    html,
  })
}

// ============================================
// EVENT EMAILS
// ============================================

interface EventAssignedEmailData {
  employeeName: string
  employeeEmail: string
  eventTitle: string
  eventDate: string
  eventTime: string
  room?: string
  role: string
}

export async function sendEventAssignedEmail(data: EventAssignedEmailData): Promise<{ success: boolean; error?: string }> {
  // Send to employee
  const employeeHtml = wrapInTemplate(`
    <div class="header" style="background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);">
      <h1>Event Assignment</h1>
    </div>
    <div class="content">
      <p>Hi ${data.employeeName},</p>
      <p>You have been assigned to an event.</p>

      <div class="info-box">
        <p class="label">Event Details</p>
        <p><strong>Event:</strong> ${data.eventTitle}</p>
        <p><strong>Date:</strong> ${data.eventDate}</p>
        <p><strong>Time:</strong> ${data.eventTime}</p>
        ${data.room ? `<p><strong>Room:</strong> ${data.room}</p>` : ''}
        <p><strong>Your Role:</strong> ${data.role}</p>
      </div>

      <p style="text-align: center;">
        <a href="https://admin.playfunia.com/employee" class="button">View Events</a>
      </p>
    </div>
  `)

  const employeeResult = await sendEmail({
    to: data.employeeEmail,
    subject: `Event Assignment - ${data.eventTitle}`,
    html: employeeHtml,
  })

  // Also notify admin and managers
  const recipients = await getAllNotificationRecipients()
  if (recipients.length > 0) {
    const adminHtml = wrapInTemplate(`
      <div class="header" style="background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);">
        <h1>Employee Assigned to Event</h1>
      </div>
      <div class="content">
        <p>An employee has been assigned to an event.</p>

        <div class="info-box">
          <p class="label">Assignment Details</p>
          <p><strong>Employee:</strong> ${data.employeeName}</p>
          <p><strong>Event:</strong> ${data.eventTitle}</p>
          <p><strong>Date:</strong> ${data.eventDate}</p>
          <p><strong>Time:</strong> ${data.eventTime}</p>
          ${data.room ? `<p><strong>Room:</strong> ${data.room}</p>` : ''}
          <p><strong>Role:</strong> ${data.role}</p>
        </div>

        <p style="text-align: center;">
          <a href="https://admin.playfunia.com/admin/events" class="button">View Events</a>
        </p>
      </div>
    `)

    await sendEmail({
      to: recipients,
      subject: `Event Assignment - ${data.employeeName} (${data.eventTitle})`,
      html: adminHtml,
    })
  }

  return employeeResult
}

interface EventRemovedEmailData {
  employeeName: string
  employeeEmail: string
  eventTitle: string
  eventDate: string
}

export async function sendEventRemovedEmail(data: EventRemovedEmailData): Promise<{ success: boolean; error?: string }> {
  // Send to employee
  const employeeHtml = wrapInTemplate(`
    <div class="header" style="background: linear-gradient(135deg, #6b7280 0%, #4b5563 100%);">
      <h1>Event Assignment Removed</h1>
    </div>
    <div class="content">
      <p>Hi ${data.employeeName},</p>
      <p>You have been removed from an event assignment.</p>

      <div class="info-box">
        <p class="label">Event Details</p>
        <p><strong>Event:</strong> ${data.eventTitle}</p>
        <p><strong>Date:</strong> ${data.eventDate}</p>
      </div>

      <p>If you have any questions, please contact your manager.</p>
    </div>
  `)

  const employeeResult = await sendEmail({
    to: data.employeeEmail,
    subject: `Removed from Event - ${data.eventTitle}`,
    html: employeeHtml,
  })

  // Also notify admin and managers
  const recipients = await getAllNotificationRecipients()
  if (recipients.length > 0) {
    const adminHtml = wrapInTemplate(`
      <div class="header" style="background: linear-gradient(135deg, #6b7280 0%, #4b5563 100%);">
        <h1>Employee Removed from Event</h1>
      </div>
      <div class="content">
        <p>An employee has been removed from an event.</p>

        <div class="info-box">
          <p class="label">Removal Details</p>
          <p><strong>Employee:</strong> ${data.employeeName}</p>
          <p><strong>Event:</strong> ${data.eventTitle}</p>
          <p><strong>Date:</strong> ${data.eventDate}</p>
        </div>

        <p style="text-align: center;">
          <a href="https://admin.playfunia.com/admin/events" class="button">View Events</a>
        </p>
      </div>
    `)

    await sendEmail({
      to: recipients,
      subject: `Event Assignment Removed - ${data.employeeName} (${data.eventTitle})`,
      html: adminHtml,
    })
  }

  return employeeResult
}

// ============================================
// EMPLOYEE MANAGEMENT EMAILS
// ============================================

interface EmployeeDeactivatedEmailData {
  employeeName: string
}

export async function sendEmployeeDeactivatedNotification(data: EmployeeDeactivatedEmailData): Promise<{ success: boolean; error?: string }> {
  const recipients = await getAllNotificationRecipients()
  if (recipients.length === 0) return { success: true }

  const html = wrapInTemplate(`
    <div class="header" style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);">
      <h1>Employee Deactivated</h1>
    </div>
    <div class="content">
      <p>An employee account has been deactivated.</p>

      <div class="info-box">
        <p><strong>Employee:</strong> ${data.employeeName}</p>
        <p><strong>Status:</strong> Inactive</p>
      </div>

      <p style="text-align: center;">
        <a href="https://admin.playfunia.com/admin/employees" class="button">View Employees</a>
      </p>
    </div>
  `)

  return sendEmail({
    to: recipients,
    subject: `Employee Deactivated - ${data.employeeName}`,
    html,
  })
}

interface EmployeeDeletedEmailData {
  employeeName: string
  email: string
  position?: string
  deletedAt: string
  deletedBy?: string
}

/**
 * Send notification when an employee is permanently deleted
 * - To the employee (if email still valid)
 * - To admin and managers
 */
export async function sendEmployeeDeletedNotification(data: EmployeeDeletedEmailData): Promise<{ success: boolean; error?: string }> {
  // Send to employee
  const employeeHtml = wrapInTemplate(`
    <div class="header" style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);">
      <h1>Account Removed</h1>
    </div>
    <div class="content">
      <p>Hi ${data.employeeName},</p>
      <p>Your employee account at PlayFunia has been removed from the system.</p>

      <div class="info-box">
        <p><strong>Effective:</strong> ${data.deletedAt}</p>
      </div>

      <p>If you believe this was done in error, please contact your manager or HR.</p>
      <p>Thank you for your time with PlayFunia.</p>
    </div>
  `)

  // Try to send to employee (might fail if email is already deleted)
  const employeeResult = await sendEmail({
    to: data.email,
    subject: 'Your PlayFunia Account Has Been Removed',
    html: employeeHtml,
  }).catch(err => {
    console.warn('Could not send deletion email to employee:', err)
    return { success: false, error: err.message }
  })

  // Send to admin and managers
  const recipients = await getAllNotificationRecipients()
  if (recipients.length > 0) {
    const adminHtml = wrapInTemplate(`
      <div class="header" style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);">
        <h1>Employee Permanently Deleted</h1>
      </div>
      <div class="content">
        <p>An employee has been permanently deleted from the system.</p>

        <div class="info-box">
          <p class="label">Deletion Details</p>
          <p><strong>Employee:</strong> ${data.employeeName}</p>
          <p><strong>Email:</strong> ${data.email}</p>
          ${data.position ? `<p><strong>Position:</strong> ${data.position}</p>` : ''}
          <p><strong>Deleted:</strong> ${data.deletedAt}</p>
        </div>

        <p style="color: #dc2626; font-weight: 600;">This action cannot be undone.</p>

        <p style="text-align: center;">
          <a href="https://admin.playfunia.com/admin/employees" class="button">View Employees</a>
        </p>
      </div>
    `)

    await sendEmail({
      to: recipients,
      subject: `Employee Deleted - ${data.employeeName}`,
      html: adminHtml,
    })
  }

  return employeeResult
}

interface EmployeeCreatedEmailData {
  employeeName: string
  email: string
  position?: string
  createdAt: string
}

/**
 * Send notification to admin and managers when a new employee is created
 */
export async function sendEmployeeCreatedNotification(data: EmployeeCreatedEmailData): Promise<{ success: boolean; error?: string }> {
  const recipients = await getAllNotificationRecipients()
  if (recipients.length === 0) return { success: true }

  const html = wrapInTemplate(`
    <div class="header" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%);">
      <h1>New Employee Created</h1>
    </div>
    <div class="content">
      <p>A new employee account has been created in the system.</p>

      <div class="info-box">
        <p class="label">New Hire Details</p>
        <p><strong>Name:</strong> ${data.employeeName}</p>
        <p><strong>Email:</strong> ${data.email}</p>
        ${data.position ? `<p><strong>Position:</strong> ${data.position}</p>` : ''}
        <p><strong>Created:</strong> ${data.createdAt}</p>
      </div>

      <p style="text-align: center;">
        <a href="https://admin.playfunia.com/admin/employees" class="button">View Employees</a>
      </p>
    </div>
  `)

  return sendEmail({
    to: recipients,
    subject: `New Employee Created - ${data.employeeName}`,
    html,
  })
}

// ============================================
// BULK SCHEDULE EMAILS
// ============================================

interface BulkSchedulesCreatedEmailData {
  employeeName: string
  scheduleCount: number
  startDate: string
  endDate: string
  days: string[]
  startTime: string
  endTime: string
}

/**
 * Send notification to admin when bulk schedules are created
 */
export async function sendBulkSchedulesCreatedNotification(data: BulkSchedulesCreatedEmailData): Promise<{ success: boolean; error?: string }> {
  const recipients = await getAllNotificationRecipients()
  if (recipients.length === 0) return { success: true }

  const daysStr = data.days.map(d => d.charAt(0).toUpperCase() + d.slice(1)).join(', ')

  const html = wrapInTemplate(`
    <div class="header">
      <h1>Bulk Schedules Created</h1>
    </div>
    <div class="content">
      <p>Bulk schedules have been created for an employee.</p>

      <div class="info-box">
        <p class="label">Schedule Summary</p>
        <p><strong>Employee:</strong> ${data.employeeName}</p>
        <p><strong>Schedules Created:</strong> ${data.scheduleCount}</p>
        <p><strong>Date Range:</strong> ${data.startDate} to ${data.endDate}</p>
        <p><strong>Days:</strong> ${daysStr}</p>
        <p><strong>Time:</strong> ${data.startTime} - ${data.endTime}</p>
      </div>

      <p style="text-align: center;">
        <a href="https://admin.playfunia.com/admin/schedules" class="button">View Schedules</a>
      </p>
    </div>
  `)

  return sendEmail({
    to: recipients,
    subject: `Bulk Schedules Created - ${data.employeeName} (${data.scheduleCount} schedules)`,
    html,
  })
}
