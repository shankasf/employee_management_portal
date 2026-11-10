/**
 * Email service using AWS SES SMTP for sending notifications.
 * This replaces Supabase email functionality with direct SMTP sending.
 */

import nodemailer from 'nodemailer'
import { createServiceClient } from './supabase/server'

// HTML escape helper to prevent XSS in email templates
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

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

// Admin emails - always receive notifications
const ADMIN_EMAILS = [
  'playfunia@playfunia.com',
].filter(Boolean)

// Admin accounts that should NOT receive notification emails (still admins, just opted out)
const BLOCKED_ADMIN_EMAILS = new Set<string>([
  'callsphereny@gmail.com',
  'ali@realinternational.tech',
])

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
  | 'task_reminder'
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
    .select('email, role, status')
    .eq('role', 'admin')

  console.log('[getAdminEmails] Query result:', { data, error })

  if (error) {
    console.error('Failed to fetch admin emails:', error)
    return []
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const emails = data?.filter((r: any) => r.status === 'active').map((r: any) => r.email).filter(Boolean)
    .filter((e: string) => !BLOCKED_ADMIN_EMAILS.has(e.toLowerCase())) || []
  console.log('[getAdminEmails] Active admin emails:', emails)
  return emails
}

/**
 * Get all notification recipients including:
 * - Default admin email (ADMIN_NOTIFICATION_EMAIL)
 * - All admin accounts from profiles table
 * - Custom notification recipients from notification_recipients table
 * This ensures all admins receive important notifications
 */
export async function getAllNotificationRecipients(): Promise<string[]> {
  console.log('[getAllNotificationRecipients] ADMIN_EMAILS:', ADMIN_EMAILS)

  // Fetch custom recipients and admin emails in parallel
  const [customRecipients, adminEmails] = await Promise.all([
    getNotificationRecipients(),
    getAdminEmails()
  ])

  console.log('[getAllNotificationRecipients] Custom recipients:', customRecipients)
  console.log('[getAllNotificationRecipients] Admin emails from profiles:', adminEmails)

  // Combine all recipients and deduplicate
  const allRecipients = new Set<string>([
    ...ADMIN_EMAILS,
    ...customRecipients,
    ...adminEmails
  ])

  const result = Array.from(allRecipients)
    .filter(Boolean)
    .filter((e) => !BLOCKED_ADMIN_EMAILS.has(e.toLowerCase()))
  console.log('[getAllNotificationRecipients] Final recipients:', result)
  return result
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
      <p>Hi ${escapeHtml(data.employeeName)},</p>
      <p>Welcome to the PlayFunia team! Your employee account has been created.</p>

      <div class="info-box">
        <p class="label">Your Login Credentials</p>
        <p><strong>Email:</strong> ${escapeHtml(data.email)}</p>
        <p><strong>Temporary Password:</strong> ${escapeHtml(data.tempPassword)}</p>
      </div>

      <p>Please log in and change your password as soon as possible.</p>

      <p style="text-align: center;">
        <a href="${escapeHtml(loginUrl)}" class="button">Login to Portal</a>
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
      <p>Hi ${escapeHtml(data.employeeName)},</p>
      <p>You have been assigned a new work schedule.</p>

      <div class="info-box">
        <p class="label">Schedule Details</p>
        <p><strong>Date:</strong> ${data.scheduleDate}</p>
        <p><strong>Time:</strong> ${data.startTime} - ${data.endTime}</p>
        ${data.notes ? `<p><strong>Notes:</strong> ${escapeHtml(data.notes)}</p>` : ''}
      </div>

      <p>Please log in to the portal to confirm your schedule.</p>

      <p style="text-align: center;">
        <a href="https://admin.playfunia.com/employee/schedules" class="button">View Schedule</a>
      </p>
    </div>
  `)

  const employeeResult = await sendEmail({
    to: data.employeeEmail,
    subject: `New Schedule Assigned - ${escapeHtml(data.scheduleDate)}`,
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
          <p><strong>Employee:</strong> ${escapeHtml(data.employeeName)}</p>
          <p><strong>Date:</strong> ${data.scheduleDate}</p>
          <p><strong>Time:</strong> ${data.startTime} - ${data.endTime}</p>
          ${data.notes ? `<p><strong>Notes:</strong> ${escapeHtml(data.notes)}</p>` : ''}
        </div>

        <p style="text-align: center;">
          <a href="https://admin.playfunia.com/admin/schedules" class="button">View Schedules</a>
        </p>
      </div>
    `)

    await sendEmail({
      to: recipients,
      subject: `Schedule Assigned - ${escapeHtml(data.employeeName)} (${escapeHtml(data.scheduleDate)})`,
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
  console.log('[Schedule Confirmed Email] Starting for:', data.employeeName, data.scheduleDate)

  // Send confirmation to the employee
  const employeeHtml = wrapInTemplate(`
    <div class="header" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%);">
      <h1>Schedule Confirmed</h1>
    </div>
    <div class="content">
      <p>Hi ${escapeHtml(data.employeeName)},</p>
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
    subject: `Schedule Confirmed - ${escapeHtml(data.scheduleDate)}`,
    html: employeeHtml,
  })

  // Send notification to all admins
  const recipients = await getAllNotificationRecipients()
  console.log('[Schedule Confirmed Email] Admin recipients found:', recipients)

  if (recipients.length > 0) {
    const adminHtml = wrapInTemplate(`
      <div class="header">
        <h1>Schedule Confirmed</h1>
      </div>
      <div class="content">
        <p>An employee has confirmed their schedule.</p>

        <div class="info-box">
          <p class="label">Confirmation Details</p>
          <p><strong>Employee:</strong> ${escapeHtml(data.employeeName)}</p>
          <p><strong>Date:</strong> ${data.scheduleDate}</p>
          <p><strong>Time:</strong> ${data.startTime} - ${data.endTime}</p>
        </div>

        <p style="text-align: center;">
          <a href="https://admin.playfunia.com/admin/schedules" class="button">View Schedules</a>
        </p>
      </div>
    `)

    const adminResult = await sendEmail({
      to: recipients,
      subject: `Schedule Confirmed - ${escapeHtml(data.employeeName)} (${escapeHtml(data.scheduleDate)})`,
      html: adminHtml,
    })
    console.log('[Schedule Confirmed Email] Admin email result:', adminResult)
  } else {
    console.warn('[Schedule Confirmed Email] No admin recipients found!')
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
        <p><strong>Employee:</strong> ${escapeHtml(data.employeeName)}</p>
        <p><strong>Date:</strong> ${data.scheduleDate}</p>
        <p><strong>Time:</strong> ${data.startTime} - ${data.endTime}</p>
        <p><strong>Reason:</strong> ${escapeHtml(data.reason)}</p>
      </div>

      <p>Please review and approve or deny this request.</p>

      <p style="text-align: center;">
        <a href="https://admin.playfunia.com/admin/schedules" class="button">Review Request</a>
      </p>
    </div>
  `)

  return sendEmail({
    to: recipients,
    subject: `Cancellation Request - ${escapeHtml(data.employeeName)} (${escapeHtml(data.scheduleDate)})`,
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
      <p>Hi ${escapeHtml(data.employeeName)},</p>
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
    subject: `Schedule Cancellation Approved - ${escapeHtml(data.scheduleDate)}`,
    html,
  })

  // Also notify admin and managers
  const recipients = await getAllNotificationRecipients()
  if (recipients.length > 0) {
    await sendEmail({
      to: recipients,
      subject: `Schedule Cancelled - ${escapeHtml(data.employeeName)} (${escapeHtml(data.scheduleDate)})`,
      html: wrapInTemplate(`
        <div class="header" style="background: linear-gradient(135deg, #6b7280 0%, #4b5563 100%);">
          <h1>Schedule Cancelled</h1>
        </div>
        <div class="content">
          <p>A schedule cancellation has been approved.</p>

          <div class="info-box">
            <p class="label">Details</p>
            <p><strong>Employee:</strong> ${escapeHtml(data.employeeName)}</p>
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
      <p>Hi ${escapeHtml(data.employeeName)},</p>
      <p>Your schedule has been cancelled by management.</p>

      <div class="info-box">
        <p class="label">Cancelled Schedule</p>
        <p><strong>Date:</strong> ${data.scheduleDate}</p>
        <p><strong>Time:</strong> ${data.startTime} - ${data.endTime}</p>
        ${data.reason ? `<p><strong>Reason:</strong> ${escapeHtml(data.reason)}</p>` : ''}
      </div>

      <p>If you have any questions, please contact your manager.</p>
    </div>
  `)

  const employeeResult = await sendEmail({
    to: data.employeeEmail,
    subject: `Schedule Cancelled - ${escapeHtml(data.scheduleDate)}`,
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
          <p><strong>Employee:</strong> ${escapeHtml(data.employeeName)}</p>
          <p><strong>Date:</strong> ${data.scheduleDate}</p>
          <p><strong>Time:</strong> ${data.startTime} - ${data.endTime}</p>
          ${data.reason ? `<p><strong>Reason:</strong> ${escapeHtml(data.reason)}</p>` : ''}
        </div>

        <p style="text-align: center;">
          <a href="https://admin.playfunia.com/admin/schedules" class="button">View Schedules</a>
        </p>
      </div>
    `)

    await sendEmail({
      to: recipients,
      subject: `Schedule Cancelled - ${escapeHtml(data.employeeName)} (${escapeHtml(data.scheduleDate)})`,
      html: adminHtml,
    })
  }

  return employeeResult
}

interface ScheduleDeletedEmailData {
  employeeName: string
  employeeEmail: string
  scheduleDate: string
  startTime: string
  endTime: string
  reason?: string
}

export async function sendScheduleDeletedEmail(data: ScheduleDeletedEmailData): Promise<{ success: boolean; error?: string }> {
  // Send to employee
  const employeeHtml = wrapInTemplate(`
    <div class="header" style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);">
      <h1>Schedule Deleted</h1>
    </div>
    <div class="content">
      <p>Hi ${escapeHtml(data.employeeName)},</p>
      <p>Your schedule has been deleted by management.</p>

      <div class="info-box">
        <p class="label">Deleted Schedule</p>
        <p><strong>Date:</strong> ${data.scheduleDate}</p>
        <p><strong>Time:</strong> ${data.startTime} - ${data.endTime}</p>
        ${data.reason ? `<p><strong>Reason:</strong> ${escapeHtml(data.reason)}</p>` : ''}
      </div>

      <p>If you have any questions, please contact your manager.</p>

      <p style="text-align: center;">
        <a href="https://admin.playfunia.com/employee/schedules" class="button">View My Schedules</a>
      </p>
    </div>
  `)

  const employeeResult = await sendEmail({
    to: data.employeeEmail,
    subject: `Schedule Deleted - ${escapeHtml(data.scheduleDate)}`,
    html: employeeHtml,
  })

  // Also notify admin and managers
  const recipients = await getAllNotificationRecipients()
  if (recipients.length > 0) {
    const adminHtml = wrapInTemplate(`
      <div class="header" style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);">
        <h1>Schedule Deleted</h1>
      </div>
      <div class="content">
        <p>A schedule has been deleted.</p>

        <div class="info-box">
          <p class="label">Deleted Schedule</p>
          <p><strong>Employee:</strong> ${escapeHtml(data.employeeName)}</p>
          <p><strong>Date:</strong> ${data.scheduleDate}</p>
          <p><strong>Time:</strong> ${data.startTime} - ${data.endTime}</p>
          ${data.reason ? `<p><strong>Reason:</strong> ${escapeHtml(data.reason)}</p>` : ''}
        </div>

        <p style="text-align: center;">
          <a href="https://admin.playfunia.com/admin/schedules" class="button">View Schedules</a>
        </p>
      </div>
    `)

    await sendEmail({
      to: recipients,
      subject: `Schedule Deleted - ${escapeHtml(data.employeeName)} (${escapeHtml(data.scheduleDate)})`,
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
      <p>Hi ${escapeHtml(data.employeeName)},</p>
      <p>You have been assigned a new task.</p>

      <div class="info-box">
        <p class="label">Task Details</p>
        <p><strong>Task:</strong> ${escapeHtml(data.taskTitle)}</p>
        ${data.taskDescription ? `<p><strong>Description:</strong> ${escapeHtml(data.taskDescription)}</p>` : ''}
        <p><strong>Date:</strong> ${data.scheduledDate}</p>
        ${data.location ? `<p><strong>Location:</strong> ${escapeHtml(data.location)}</p>` : ''}
      </div>

      <p style="text-align: center;">
        <a href="https://admin.playfunia.com/employee/tasks" class="button">View Tasks</a>
      </p>
    </div>
  `)

  const employeeResult = await sendEmail({
    to: data.employeeEmail,
    subject: `New Task Assigned - ${escapeHtml(data.taskTitle)}`,
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
          <p><strong>Employee:</strong> ${escapeHtml(data.employeeName)}</p>
          <p><strong>Task:</strong> ${escapeHtml(data.taskTitle)}</p>
          ${data.taskDescription ? `<p><strong>Description:</strong> ${escapeHtml(data.taskDescription)}</p>` : ''}
          <p><strong>Date:</strong> ${data.scheduledDate}</p>
          ${data.location ? `<p><strong>Location:</strong> ${escapeHtml(data.location)}</p>` : ''}
        </div>

        <p style="text-align: center;">
          <a href="https://admin.playfunia.com/admin/tasks" class="button">View Tasks</a>
        </p>
      </div>
    `)

    await sendEmail({
      to: recipients,
      subject: `Task Assigned - ${escapeHtml(data.employeeName)} (${escapeHtml(data.taskTitle)})`,
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
        <p><strong>Employee:</strong> ${escapeHtml(data.employeeName)}</p>
        <p><strong>Task:</strong> ${escapeHtml(data.taskTitle)}</p>
        <p><strong>Scheduled Date:</strong> ${data.scheduledDate}</p>
        <p><strong>Completed At:</strong> ${data.completedAt}</p>
        ${data.notes ? `<p><strong>Notes:</strong> ${escapeHtml(data.notes)}</p>` : ''}
      </div>

      <p style="text-align: center;">
        <a href="https://admin.playfunia.com/admin/tasks" class="button">View Tasks</a>
      </p>
    </div>
  `)

  return sendEmail({
    to: recipients,
    subject: `Task Completed - ${escapeHtml(data.taskTitle)} by ${escapeHtml(data.employeeName)}`,
    html,
  })
}

// ============================================
// TASK REMINDER EMAIL
// ============================================

interface TaskReminderEmailData {
  employeeName: string
  employeeEmail: string
  taskNames: string[]
}

export async function sendTaskReminderEmail(data: TaskReminderEmailData): Promise<{ success: boolean; error?: string }> {
  const taskListHtml = data.taskNames
    .map(name => `<li style="padding: 4px 0;">${escapeHtml(name)}</li>`)
    .join('')

  const html = wrapInTemplate(`
    <div class="header" style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);">
      <h1>Reminder to Finish Tasks</h1>
    </div>
    <div class="content">
      <p>Hi ${escapeHtml(data.employeeName)},</p>
      <p>You clocked out with the following tasks still pending:</p>

      <div class="info-box">
        <p class="label">Pending Tasks</p>
        <ul style="margin: 8px 0; padding-left: 20px;">
          ${taskListHtml}
        </ul>
      </div>

      <p>Please complete these tasks as soon as possible.</p>

      <p style="text-align: center;">
        <a href="https://admin.playfunia.com/employee/tasks" class="button" style="background: #f59e0b;">View Tasks</a>
      </p>
    </div>
  `)

  return sendEmail({
    to: data.employeeEmail,
    subject: 'Reminder to finish task',
    html,
  })
}

// ============================================
// TASK DEADLINE REMINDER EMAIL
// ============================================

interface TaskDeadlineReminderEmailData {
  employeeName: string
  employeeEmail: string
  taskTitle: string
  taskDescription?: string
  scheduledDate: string
  cutoffTime: string
  location?: string
}

export async function sendTaskDeadlineReminderEmail(data: TaskDeadlineReminderEmailData): Promise<{ success: boolean; error?: string }> {
  const html = wrapInTemplate(`
    <div class="header" style="background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);">
      <h1>Task Deadline Reminder</h1>
    </div>
    <div class="content">
      <p>Hi ${escapeHtml(data.employeeName)},</p>
      <p>This is a reminder that your task is due soon. Please complete it before the deadline.</p>

      <div class="info-box">
        <p class="label">Task Details</p>
        <p><strong>Task:</strong> ${escapeHtml(data.taskTitle)}</p>
        ${data.taskDescription ? `<p><strong>Description:</strong> ${escapeHtml(data.taskDescription)}</p>` : ''}
        <p><strong>Date:</strong> ${escapeHtml(data.scheduledDate)}</p>
        <p><strong>Deadline:</strong> ${escapeHtml(data.cutoffTime)}</p>
        ${data.location ? `<p><strong>Location:</strong> ${escapeHtml(data.location)}</p>` : ''}
      </div>

      <p style="text-align: center;">
        <a href="https://admin.playfunia.com/employee/tasks" class="button" style="background: #f97316;">Complete Task Now</a>
      </p>
    </div>
  `)

  return sendEmail({
    to: data.employeeEmail,
    subject: `Deadline Reminder: ${data.taskTitle}`,
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
      <p>Hi ${escapeHtml(data.employeeName)},</p>
      <p>You have been assigned to an event.</p>

      <div class="info-box">
        <p class="label">Event Details</p>
        <p><strong>Event:</strong> ${escapeHtml(data.eventTitle)}</p>
        <p><strong>Date:</strong> ${data.eventDate}</p>
        <p><strong>Time:</strong> ${data.eventTime}</p>
        ${data.room ? `<p><strong>Room:</strong> ${escapeHtml(data.room || '')}</p>` : ''}
        <p><strong>Your Role:</strong> ${escapeHtml(data.role)}</p>
      </div>

      <p style="text-align: center;">
        <a href="https://admin.playfunia.com/employee" class="button">View Events</a>
      </p>
    </div>
  `)

  const employeeResult = await sendEmail({
    to: data.employeeEmail,
    subject: `Event Assignment - ${escapeHtml(data.eventTitle)}`,
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
          <p><strong>Employee:</strong> ${escapeHtml(data.employeeName)}</p>
          <p><strong>Event:</strong> ${escapeHtml(data.eventTitle)}</p>
          <p><strong>Date:</strong> ${data.eventDate}</p>
          <p><strong>Time:</strong> ${data.eventTime}</p>
          ${data.room ? `<p><strong>Room:</strong> ${escapeHtml(data.room || '')}</p>` : ''}
          <p><strong>Role:</strong> ${escapeHtml(data.role)}</p>
        </div>

        <p style="text-align: center;">
          <a href="https://admin.playfunia.com/admin/events" class="button">View Events</a>
        </p>
      </div>
    `)

    await sendEmail({
      to: recipients,
      subject: `Event Assignment - ${escapeHtml(data.employeeName)} (${escapeHtml(data.eventTitle)})`,
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
      <p>Hi ${escapeHtml(data.employeeName)},</p>
      <p>You have been removed from an event assignment.</p>

      <div class="info-box">
        <p class="label">Event Details</p>
        <p><strong>Event:</strong> ${escapeHtml(data.eventTitle)}</p>
        <p><strong>Date:</strong> ${data.eventDate}</p>
      </div>

      <p>If you have any questions, please contact your manager.</p>
    </div>
  `)

  const employeeResult = await sendEmail({
    to: data.employeeEmail,
    subject: `Removed from Event - ${escapeHtml(data.eventTitle)}`,
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
          <p><strong>Employee:</strong> ${escapeHtml(data.employeeName)}</p>
          <p><strong>Event:</strong> ${escapeHtml(data.eventTitle)}</p>
          <p><strong>Date:</strong> ${data.eventDate}</p>
        </div>

        <p style="text-align: center;">
          <a href="https://admin.playfunia.com/admin/events" class="button">View Events</a>
        </p>
      </div>
    `)

    await sendEmail({
      to: recipients,
      subject: `Event Assignment Removed - ${escapeHtml(data.employeeName)} (${escapeHtml(data.eventTitle)})`,
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
        <p><strong>Employee:</strong> ${escapeHtml(data.employeeName)}</p>
        <p><strong>Status:</strong> Inactive</p>
      </div>

      <p style="text-align: center;">
        <a href="https://admin.playfunia.com/admin/employees" class="button">View Employees</a>
      </p>
    </div>
  `)

  return sendEmail({
    to: recipients,
    subject: `Employee Deactivated - ${escapeHtml(data.employeeName)}`,
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
      <p>Hi ${escapeHtml(data.employeeName)},</p>
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
          <p><strong>Employee:</strong> ${escapeHtml(data.employeeName)}</p>
          <p><strong>Email:</strong> ${escapeHtml(data.email)}</p>
          ${data.position ? `<p><strong>Position:</strong> ${escapeHtml(data.position || '')}</p>` : ''}
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
      subject: `Employee Deleted - ${escapeHtml(data.employeeName)}`,
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
        <p><strong>Name:</strong> ${escapeHtml(data.employeeName)}</p>
        <p><strong>Email:</strong> ${escapeHtml(data.email)}</p>
        ${data.position ? `<p><strong>Position:</strong> ${escapeHtml(data.position || '')}</p>` : ''}
        <p><strong>Created:</strong> ${data.createdAt}</p>
      </div>

      <p style="text-align: center;">
        <a href="https://admin.playfunia.com/admin/employees" class="button">View Employees</a>
      </p>
    </div>
  `)

  return sendEmail({
    to: recipients,
    subject: `New Employee Created - ${escapeHtml(data.employeeName)}`,
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
  dayTimes?: Record<string, { start_time: string; end_time: string }>
}

/**
 * Send notification to admin when bulk schedules are created
 */
export async function sendBulkSchedulesCreatedNotification(data: BulkSchedulesCreatedEmailData): Promise<{ success: boolean; error?: string }> {
  const recipients = await getAllNotificationRecipients()
  if (recipients.length === 0) return { success: true }

  const daysStr = data.days.map(d => d.charAt(0).toUpperCase() + d.slice(1)).join(', ')

  // Build time display: per-day breakdown or single time
  let timeHtml: string
  if (data.dayTimes) {
    const dayOrder = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    const sortedDays = data.days.sort((a, b) => dayOrder.indexOf(a) - dayOrder.indexOf(b))
    timeHtml = sortedDays.map(day => {
      const times = data.dayTimes![day]
      if (!times) return ''
      const dayLabel = day.charAt(0).toUpperCase() + day.slice(1, 3)
      return `<p style="margin: 2px 0;"><strong>${escapeHtml(dayLabel)}:</strong> ${escapeHtml(times.start_time)} - ${escapeHtml(times.end_time)}</p>`
    }).join('')
  } else {
    timeHtml = `<p><strong>Time:</strong> ${escapeHtml(data.startTime)} - ${escapeHtml(data.endTime)}</p>`
  }

  const html = wrapInTemplate(`
    <div class="header">
      <h1>Bulk Schedules Created</h1>
    </div>
    <div class="content">
      <p>Bulk schedules have been created for an employee.</p>

      <div class="info-box">
        <p class="label">Schedule Summary</p>
        <p><strong>Employee:</strong> ${escapeHtml(data.employeeName)}</p>
        <p><strong>Schedules Created:</strong> ${data.scheduleCount}</p>
        <p><strong>Date Range:</strong> ${data.startDate} to ${data.endDate}</p>
        <p><strong>Days:</strong> ${escapeHtml(daysStr)}</p>
        ${timeHtml}
      </div>

      <p style="text-align: center;">
        <a href="https://admin.playfunia.com/admin/schedules" class="button">View Schedules</a>
      </p>
    </div>
  `)

  return sendEmail({
    to: recipients,
    subject: `Bulk Schedules Created - ${escapeHtml(data.employeeName)} (${data.scheduleCount} schedules)`,
    html,
  })
}

// ============================================
// PASSWORD RESET EMAIL
// ============================================

// ============================================
// POLICY EMAIL
// ============================================

interface PolicyEmailData {
  employeeName: string
  employeeEmail: string
  policyTitle: string
  policyContent: string
  policyCategory?: string
  imageUrl?: string
  videoUrl?: string
}

/**
 * Send policy to employee via email
 */
export async function sendPolicyEmail(data: PolicyEmailData): Promise<{ success: boolean; error?: string }> {
  let mediaHtml = ''
  if (data.imageUrl) {
    mediaHtml = `
      <div style="margin: 15px 0; text-align: center;">
        <img src="${escapeHtml(data.imageUrl)}" alt="Policy Image" style="max-width: 100%; max-height: 300px; border-radius: 8px;" />
      </div>
    `
  } else if (data.videoUrl) {
    mediaHtml = `
      <div style="margin: 15px 0; text-align: center;">
        <p style="color: #6b7280; font-size: 14px;">
          <a href="${escapeHtml(data.videoUrl)}" style="color: #3b82f6;">Click here to view the policy video</a>
        </p>
      </div>
    `
  }

  const html = wrapInTemplate(`
    <div class="header" style="background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);">
      <h1>Company Policy</h1>
    </div>
    <div class="content">
      <p>Hi ${escapeHtml(data.employeeName)},</p>
      <p>Please review the following company policy:</p>

      <div class="info-box">
        <p class="label">${escapeHtml(data.policyCategory || 'Policy')}</p>
        <p style="font-size: 18px; font-weight: 600; color: #111827; margin-bottom: 10px;">${escapeHtml(data.policyTitle)}</p>
        <p style="white-space: pre-wrap;">${escapeHtml(data.policyContent)}</p>
        ${mediaHtml}
      </div>

      <p>Please ensure you understand and follow this policy. If you have any questions, contact your manager.</p>

      <p style="text-align: center;">
        <a href="https://admin.playfunia.com/employee" class="button">Go to Employee Portal</a>
      </p>
    </div>
  `)

  const employeeResult = await sendEmail({
    to: data.employeeEmail,
    subject: `Company Policy: ${escapeHtml(data.policyTitle)}`,
    html,
  })

  // Also notify admins that policy was sent
  const recipients = await getAllNotificationRecipients()
  if (recipients.length > 0) {
    const adminHtml = wrapInTemplate(`
      <div class="header" style="background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);">
        <h1>Policy Sent to Employee</h1>
      </div>
      <div class="content">
        <p>A policy has been sent to an employee.</p>

        <div class="info-box">
          <p class="label">Details</p>
          <p><strong>Employee:</strong> ${escapeHtml(data.employeeName)}</p>
          <p><strong>Email:</strong> ${escapeHtml(data.employeeEmail)}</p>
          <p><strong>Policy:</strong> ${escapeHtml(data.policyTitle)}</p>
          ${data.policyCategory ? `<p><strong>Category:</strong> ${escapeHtml(data.policyCategory)}</p>` : ''}
        </div>

        <p style="text-align: center;">
          <a href="https://admin.playfunia.com/admin/policies" class="button">View Policies</a>
        </p>
      </div>
    `)

    await sendEmail({
      to: recipients,
      subject: `Policy Sent - ${escapeHtml(data.policyTitle)} to ${escapeHtml(data.employeeName)}`,
      html: adminHtml,
    })
  }

  return employeeResult
}

interface PasswordResetEmailData {
  email: string
  name: string
  resetUrl: string
}

/**
 * Send password reset email via AWS SES
 */
export async function sendPasswordResetEmail(data: PasswordResetEmailData): Promise<{ success: boolean; error?: string }> {
  const html = wrapInTemplate(`
    <div class="header" style="background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);">
      <h1>Reset Your Password</h1>
    </div>
    <div class="content">
      <p>Hi ${escapeHtml(data.name)},</p>
      <p>We received a request to reset your password for your PlayFunia Employee Portal account.</p>

      <p style="text-align: center; margin: 30px 0;">
        <a href="${escapeHtml(data.resetUrl)}" class="button" style="background: #10b981; color: #ffffff !important; text-decoration: none;">Reset Password</a>
      </p>

      <div class="info-box" style="background: #fef3c7; border-color: #f59e0b;">
        <p style="margin: 0; color: #92400e; font-size: 14px;">
          <strong>⚠️ This link expires in 1 hour.</strong>
        </p>
      </div>

      <p style="color: #6b7280; font-size: 14px; margin-top: 20px;">
        If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.
      </p>

      <p style="color: #9ca3af; font-size: 12px; margin-top: 30px;">
        If the button doesn't work, copy and paste this link into your browser:<br>
        <a href="${escapeHtml(data.resetUrl)}" style="color: #6366f1; word-break: break-all;">${escapeHtml(data.resetUrl)}</a>
      </p>
    </div>
  `)

  return sendEmail({
    to: data.email,
    subject: 'Reset Your Password - PlayFunia Employee Portal',
    html,
  })
}

// ============================================
// CLOCK-IN REMINDER EMAIL
// ============================================

interface ClockInReminderEmailData {
  employeeName: string
  employeeEmail: string
  scheduleDate: string
  startTime: string
  endTime: string
  location?: string
}

export async function sendClockInReminderEmail(data: ClockInReminderEmailData): Promise<{ success: boolean; error?: string }> {
  const html = wrapInTemplate(`
    <div class="header" style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);">
      <h1>Clock-In Reminder</h1>
    </div>
    <div class="content">
      <p>Hi ${escapeHtml(data.employeeName)},</p>
      <p>Your shift was scheduled to start at <strong>${escapeHtml(data.startTime)}</strong> but we haven't recorded a clock-in yet. Please clock in as soon as possible.</p>

      <div class="info-box">
        <p class="label">Schedule Details</p>
        <p><strong>Date:</strong> ${escapeHtml(data.scheduleDate)}</p>
        <p><strong>Shift:</strong> ${escapeHtml(data.startTime)} - ${escapeHtml(data.endTime)}</p>
        ${data.location ? `<p><strong>Location:</strong> ${escapeHtml(data.location)}</p>` : ''}
      </div>

      <p style="text-align: center;">
        <a href="https://admin.playfunia.com/employee/attendance" class="button" style="background: #ef4444;">Clock In Now</a>
      </p>
    </div>
  `)

  return sendEmail({
    to: data.employeeEmail,
    subject: `Reminder: Please Clock In - Shift Started at ${data.startTime}`,
    html,
  })
}

// ============================================
// CLOCK-OUT REMINDER EMAIL
// ============================================

interface ClockOutReminderEmailData {
  employeeName: string
  employeeEmail: string
  scheduleDate: string
  startTime: string
  endTime: string
  location?: string
}

export async function sendClockOutReminderEmail(data: ClockOutReminderEmailData): Promise<{ success: boolean; error?: string }> {
  const html = wrapInTemplate(`
    <div class="header" style="background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);">
      <h1>Clock-Out Reminder</h1>
    </div>
    <div class="content">
      <p>Hi ${escapeHtml(data.employeeName)},</p>
      <p>Your shift was scheduled to end at <strong>${escapeHtml(data.endTime)}</strong> but we haven't recorded a clock-out yet. Please clock out as soon as possible.</p>

      <div class="info-box">
        <p class="label">Schedule Details</p>
        <p><strong>Date:</strong> ${escapeHtml(data.scheduleDate)}</p>
        <p><strong>Shift:</strong> ${escapeHtml(data.startTime)} - ${escapeHtml(data.endTime)}</p>
        ${data.location ? `<p><strong>Location:</strong> ${escapeHtml(data.location)}</p>` : ''}
      </div>

      <p style="text-align: center;">
        <a href="https://admin.playfunia.com/employee/attendance" class="button" style="background: #f97316;">Clock Out Now</a>
      </p>
    </div>
  `)

  return sendEmail({
    to: data.employeeEmail,
    subject: `Reminder: Please Clock Out - Shift Ended at ${data.endTime}`,
    html,
  })
}

// ============================================
// ONBOARDING COMPLETION EMAIL (admins)
// ============================================

interface OnboardingCompletionEmailData {
  employeeName: string
  employeeEmail: string
  businessName: string
  businessLocation: string | null
  completedAt: string // ISO string
  totalRequired: number
}

export async function sendOnboardingCompletionEmail(
  data: OnboardingCompletionEmailData
): Promise<{ success: boolean; error?: string }> {
  const recipients = await getAllNotificationRecipients()
  if (recipients.length === 0) {
    return { success: false, error: 'No notification recipients configured' }
  }

  const businessLabel = data.businessLocation
    ? `${data.businessName} — ${data.businessLocation}`
    : data.businessName

  const completedDateNY = new Date(data.completedAt).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })

  const html = wrapInTemplate(`
    <div class="header" style="background: linear-gradient(135deg, #16a34a 0%, #15803d 100%);">
      <h1>Onboarding Completed</h1>
    </div>
    <div class="content">
      <p>An employee has completed their onboarding.</p>

      <div class="info-box">
        <p class="label">Employee</p>
        <p class="value">${escapeHtml(data.employeeName)}</p>
        <p style="color:#6b7280;font-size:14px;margin:4px 0 0 0;">${escapeHtml(data.employeeEmail)}</p>
      </div>

      <div class="info-box">
        <p class="label">Company / Location</p>
        <p class="value">${escapeHtml(businessLabel)}</p>
      </div>

      <div class="info-box">
        <p class="label">Completed</p>
        <p class="value">${escapeHtml(completedDateNY)}</p>
        <p style="color:#6b7280;font-size:14px;margin:4px 0 0 0;">${data.totalRequired} required item${data.totalRequired === 1 ? '' : 's'} completed</p>
      </div>

      <p style="text-align: center;">
        <a href="https://admin.playfunia.com/admin/onboarding/progress" class="button" style="background:#16a34a;">View Progress Dashboard</a>
      </p>
    </div>
  `)

  return sendEmail({
    to: recipients,
    subject: `Onboarding Completed: ${data.employeeName} — ${businessLabel}`,
    html,
  })
}
