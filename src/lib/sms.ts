/**
 * SMS service using Twilio for A2P 10DLC operational SMS to employees.
 *
 * Campaign: CTU2FPY (Low Volume Mixed). Approved employee use cases:
 *   1. Work schedule assignments
 *   2. Task assignment alerts
 *   3. Clock-in / clock-out reminders
 *
 * All other employee notifications (welcome, password reset, deletion,
 * events, policies, admin pings) intentionally go via email only — they
 * are not part of the approved campaign and would risk carrier filtering.
 *
 * Every message is sent through the registered Messaging Service SID so
 * it is attributed to the approved campaign, prefixed with "Playfunia",
 * and ends with "Reply STOP to opt out." for compliance.
 */

import twilio from 'twilio'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

const accountSid = process.env.TWILIO_ACCOUNT_SID || ''
const authToken = process.env.TWILIO_AUTH_TOKEN || ''
const apiKeySid = process.env.TWILIO_API_KEY_SID || ''
const apiKeySecret = process.env.TWILIO_API_KEY_SECRET || ''
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER || ''
const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID || ''

const STOP_TRAILER = 'Reply STOP to opt out.'

// Twilio error code returned when sending to a recipient who has opted out (STOP).
const TWILIO_UNSUBSCRIBED_CODE = 21610

let twilioClient: twilio.Twilio | null = null

// ============================================================
// Supabase service-role client (no cookie context — safe in libs/cron)
// Used for the SMS unsubscribe registry and send logging.
// ============================================================
let supabaseAdmin: SupabaseClient | null = null

function getSupabaseAdmin(): SupabaseClient | null {
  if (supabaseAdmin) return supabaseAdmin
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    console.warn('[SMS] Supabase service credentials missing — unsubscribe/logging disabled')
    return null
  }
  supabaseAdmin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return supabaseAdmin
}

/** Message category, persisted to sms_logs for auditing. */
export type SMSMessageType =
  | 'schedule_assigned'
  | 'schedule_confirmed'
  | 'cancellation_approved'
  | 'admin_cancelled'
  | 'schedule_deleted'
  | 'task_assigned'
  | 'task_deadline_reminder'
  | 'clock_in_reminder'
  | 'clock_out_reminder'
  | 'other'

type SMSLogStatus = 'sent' | 'failed' | 'skipped_unsubscribed' | 'invalid_number'

/**
 * Fire-and-forget insert into sms_logs. Never throws — logging must never break
 * the notification flow.
 */
async function logSMS(entry: {
  phone: string
  messageType: SMSMessageType
  body: string
  status: SMSLogStatus
  twilioSid?: string | null
  errorCode?: string | number | null
  errorMessage?: string | null
}): Promise<void> {
  try {
    const db = getSupabaseAdmin()
    if (!db) return
    const { error } = await db.from('sms_logs').insert({
      phone: entry.phone,
      message_type: entry.messageType,
      body: entry.body,
      status: entry.status,
      twilio_sid: entry.twilioSid ?? null,
      error_code: entry.errorCode != null ? String(entry.errorCode) : null,
      error_message: entry.errorMessage ?? null,
    })
    if (error) console.error('[SMS] Failed to write sms_logs:', error.message)
  } catch (err) {
    console.error('[SMS] Exception writing sms_logs:', err instanceof Error ? err.message : err)
  }
}

/**
 * Returns true if the number is currently opted out (active unsubscribe row).
 * On any DB/credential error we return false (fail-open) so a transient DB
 * problem never blocks legitimate operational SMS — the 21610 guard at send
 * time still protects us.
 */
async function isUnsubscribed(phone: string): Promise<boolean> {
  try {
    const db = getSupabaseAdmin()
    if (!db) return false
    const { data, error } = await db
      .from('sms_unsubscribes')
      .select('phone')
      .eq('phone', phone)
      .eq('active', true)
      .maybeSingle()
    if (error) {
      console.error('[SMS] Unsubscribe lookup failed:', error.message)
      return false
    }
    return !!data
  } catch (err) {
    console.error('[SMS] Exception in unsubscribe lookup:', err instanceof Error ? err.message : err)
    return false
  }
}

/**
 * Record (or refresh) an opt-out in the registry. Idempotent via upsert on the
 * unique `phone` column. Used both by the 21610 capture path and the inbound
 * STOP webhook.
 */
export async function recordUnsubscribe(
  phone: string,
  source: 'twilio_21610' | 'inbound_stop' | 'manual',
  opts?: { reason?: string; messageSid?: string },
): Promise<void> {
  const formatted = formatPhoneNumber(phone) || phone
  try {
    const db = getSupabaseAdmin()
    if (!db) return
    const { error } = await db.from('sms_unsubscribes').upsert(
      {
        phone: formatted,
        active: true,
        reason: opts?.reason ?? null,
        source,
        last_message_sid: opts?.messageSid ?? null,
        unsubscribed_at: new Date().toISOString(),
        resubscribed_at: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'phone' },
    )
    if (error) console.error('[SMS] Failed to record unsubscribe:', error.message)
    else console.warn(`[SMS] Recorded opt-out for ${formatted} (source=${source})`)
  } catch (err) {
    console.error('[SMS] Exception recording unsubscribe:', err instanceof Error ? err.message : err)
  }
}

/**
 * Record an opt-in (START/UNSTOP), flipping the registry row to inactive so the
 * number can be texted again. Keeps the row for audit history.
 */
export async function recordResubscribe(
  phone: string,
  opts?: { messageSid?: string },
): Promise<void> {
  const formatted = formatPhoneNumber(phone) || phone
  try {
    const db = getSupabaseAdmin()
    if (!db) return
    const { error } = await db
      .from('sms_unsubscribes')
      .update({
        active: false,
        source: 'inbound_start',
        last_message_sid: opts?.messageSid ?? null,
        resubscribed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('phone', formatted)
    if (error) console.error('[SMS] Failed to record resubscribe:', error.message)
    else console.log(`[SMS] Recorded opt-in for ${formatted}`)
  } catch (err) {
    console.error('[SMS] Exception recording resubscribe:', err instanceof Error ? err.message : err)
  }
}

function getTwilioClient(): twilio.Twilio | null {
  if (twilioClient) return twilioClient

  if (!accountSid) {
    console.warn('[SMS] TWILIO_ACCOUNT_SID not configured — SMS disabled')
    return null
  }

  // Prefer API key auth (revocable, preferred for prod). Fall back to auth token.
  if (apiKeySid && apiKeySecret) {
    twilioClient = twilio(apiKeySid, apiKeySecret, { accountSid })
  } else if (authToken) {
    twilioClient = twilio(accountSid, authToken)
  } else {
    console.warn('[SMS] No Twilio credentials configured — SMS disabled')
    return null
  }

  return twilioClient
}

interface SendSMSOptions {
  to: string | string[]
  body: string
  /** Category persisted to sms_logs. Defaults to 'other'. */
  messageType?: SMSMessageType
}

/**
 * Format phone number to E.164. Assumes US if no country code.
 */
function formatPhoneNumber(phone: string): string | null {
  if (!phone) return null
  let cleaned = phone.replace(/[^\d+]/g, '')
  if (!cleaned.startsWith('+')) {
    if (cleaned.startsWith('1') && cleaned.length === 11) {
      cleaned = cleaned.substring(1)
    }
    if (cleaned.length === 10) {
      cleaned = '+1' + cleaned
    }
  }
  if (/^\+\d{10,15}$/.test(cleaned)) return cleaned
  console.warn(`[SMS] Invalid phone number format: ${phone}`)
  return null
}

/**
 * Send an SMS via the approved A2P 10DLC Messaging Service.
 * Falls back to the registered phone number if the service SID is not set.
 */
export async function sendSMS(options: SendSMSOptions): Promise<{ success: boolean; error?: string }> {
  const client = getTwilioClient()
  if (!client) return { success: false, error: 'Twilio not configured' }

  if (!messagingServiceSid && !twilioPhoneNumber) {
    return { success: false, error: 'No Twilio sender configured (messaging service or phone number)' }
  }

  const recipients = Array.isArray(options.to) ? options.to : [options.to]
  const messageType: SMSMessageType = options.messageType ?? 'other'
  const results: { success: boolean; phone: string; error?: string }[] = []

  for (const recipient of recipients) {
    const formattedPhone = formatPhoneNumber(recipient)
    if (!formattedPhone) {
      console.warn(`[SMS] Invalid phone number, not sending: ${recipient}`)
      await logSMS({
        phone: recipient,
        messageType,
        body: options.body,
        status: 'invalid_number',
        errorMessage: 'Invalid phone number format',
      })
      results.push({ success: false, phone: recipient, error: 'Invalid phone number' })
      continue
    }

    // Compliance guard: never attempt delivery to a number that has opted out.
    // This is what prevents the recurring Twilio 21610 errors.
    if (await isUnsubscribed(formattedPhone)) {
      console.warn(`[SMS] Skipping ${formattedPhone} — recipient is unsubscribed (opted out)`)
      await logSMS({
        phone: formattedPhone,
        messageType,
        body: options.body,
        status: 'skipped_unsubscribed',
        errorCode: TWILIO_UNSUBSCRIBED_CODE,
        errorMessage: 'Recipient has opted out (STOP); send suppressed locally',
      })
      // Treat as "handled" so a single opted-out recipient in a batch does not
      // mark the whole notification as failed.
      results.push({ success: true, phone: formattedPhone })
      continue
    }

    try {
      const messageOptions: {
        body: string
        to: string
        messagingServiceSid?: string
        from?: string
      } = {
        body: options.body,
        to: formattedPhone,
      }

      // Prefer Messaging Service SID — required for A2P 10DLC campaign attribution.
      if (messagingServiceSid) {
        messageOptions.messagingServiceSid = messagingServiceSid
      } else {
        messageOptions.from = twilioPhoneNumber
      }

      const message = await client.messages.create(messageOptions)

      console.log(`[SMS] Sent ${message.sid} to ${formattedPhone} (${messageType})`)
      await logSMS({
        phone: formattedPhone,
        messageType,
        body: options.body,
        status: 'sent',
        twilioSid: message.sid,
      })
      results.push({ success: true, phone: formattedPhone })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      // Twilio errors carry a numeric `code`. 21610 = recipient unsubscribed.
      const errorCode = (error as { code?: number })?.code ?? null

      if (errorCode === TWILIO_UNSUBSCRIBED_CODE) {
        // The carrier/Twilio knows this number opted out but our registry didn't.
        // Backfill the registry so we suppress it locally from now on.
        console.error(`[SMS] 21610 unsubscribed recipient ${formattedPhone} — recording opt-out`)
        await recordUnsubscribe(formattedPhone, 'twilio_21610', {
          reason: 'Captured from Twilio 21610 send error',
        })
      } else {
        console.error(`[SMS] Failed to send to ${formattedPhone} (code=${errorCode}):`, errorMessage)
      }

      await logSMS({
        phone: formattedPhone,
        messageType,
        body: options.body,
        status: 'failed',
        errorCode,
        errorMessage,
      })
      results.push({ success: false, phone: formattedPhone, error: errorMessage })
    }
  }

  const successCount = results.filter(r => r.success).length
  const failCount = results.filter(r => !r.success).length

  if (failCount === 0) return { success: true }
  if (successCount === 0) return { success: false, error: `All ${failCount} SMS failed to send` }
  return { success: true, error: `${successCount} sent, ${failCount} failed` }
}

function compose(body: string): string {
  return `${body} ${STOP_TRAILER}`
}

// ============================================
// SCHEDULE SMS — approved use case #1
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
  const body = compose(
    `Playfunia Staff Schedule: Hi ${data.employeeName}, you've been assigned a new shift on ${data.scheduleDate} from ${data.startTime}-${data.endTime}.${data.notes ? ` Notes: ${data.notes}` : ''} Please log in to confirm.`
  )
  return sendSMS({ to: data.employeePhone, body, messageType: 'schedule_assigned' })
}

interface ScheduleConfirmedSMSData {
  employeeName: string
  employeePhone: string
  scheduleDate: string
  startTime: string
  endTime: string
}

export async function sendScheduleConfirmedSMS(data: ScheduleConfirmedSMSData): Promise<{ success: boolean; error?: string }> {
  const body = compose(
    `Playfunia Staff Schedule: Hi ${data.employeeName}, your shift on ${data.scheduleDate} (${data.startTime}-${data.endTime}) is confirmed. See you then!`
  )
  return sendSMS({ to: data.employeePhone, body, messageType: 'schedule_confirmed' })
}

interface CancellationApprovedSMSData {
  employeeName: string
  employeePhone: string
  scheduleDate: string
  startTime: string
  endTime: string
}

export async function sendCancellationApprovedSMS(data: CancellationApprovedSMSData): Promise<{ success: boolean; error?: string }> {
  const body = compose(
    `Playfunia Staff Schedule: Hi ${data.employeeName}, your cancellation request for ${data.scheduleDate} (${data.startTime}-${data.endTime}) was approved. You are no longer scheduled.`
  )
  return sendSMS({ to: data.employeePhone, body, messageType: 'cancellation_approved' })
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
  const body = compose(
    `Playfunia Staff Schedule: Hi ${data.employeeName}, your shift on ${data.scheduleDate} (${data.startTime}-${data.endTime}) was cancelled by management.${data.reason ? ` Reason: ${data.reason}` : ''}`
  )
  return sendSMS({ to: data.employeePhone, body, messageType: 'admin_cancelled' })
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
  const body = compose(
    `Playfunia Staff Schedule: Hi ${data.employeeName}, your shift on ${data.scheduleDate} (${data.startTime}-${data.endTime}) was removed.${data.reason ? ` Reason: ${data.reason}` : ''} Contact your manager with questions.`
  )
  return sendSMS({ to: data.employeePhone, body, messageType: 'schedule_deleted' })
}

// ============================================
// TASK SMS — approved use case #2
// ============================================

interface TaskAssignedSMSData {
  employeeName: string
  employeePhone: string
  taskTitle: string
  scheduledDate: string
  cutoffTime?: string
  location?: string
  taskDescription?: string
  taskUrl: string
}

const TASK_DESCRIPTION_MAX_LEN = 80

function truncate(text: string, maxLen: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= maxLen) return collapsed
  return collapsed.slice(0, maxLen - 1).trimEnd() + '…'
}

export async function sendTaskAssignedSMS(data: TaskAssignedSMSData): Promise<{ success: boolean; error?: string }> {
  const dueClause = data.cutoffTime
    ? `due ${data.scheduledDate} by ${data.cutoffTime}`
    : `for ${data.scheduledDate}`
  const locationClause = data.location ? ` at ${data.location}` : ''
  const descriptionClause = data.taskDescription
    ? ` ${truncate(data.taskDescription, TASK_DESCRIPTION_MAX_LEN)}.`
    : ''

  const body = compose(
    `Playfunia Staff Task Alert: Hi ${data.employeeName}, new task "${data.taskTitle}" assigned, ${dueClause}${locationClause}.${descriptionClause} View: ${data.taskUrl}`
  )
  return sendSMS({ to: data.employeePhone, body, messageType: 'task_assigned' })
}

interface TaskDeadlineReminderSMSData {
  employeeName: string
  employeePhone: string
  taskTitle: string
  cutoffTime: string
}

export async function sendTaskDeadlineReminderSMS(data: TaskDeadlineReminderSMSData): Promise<{ success: boolean; error?: string }> {
  const body = compose(
    `Playfunia Staff Task Alert: Hi ${data.employeeName}, your task "${data.taskTitle}" is due at ${data.cutoffTime}. Please complete it before the deadline.`
  )
  return sendSMS({ to: data.employeePhone, body, messageType: 'task_deadline_reminder' })
}

// ============================================
// CLOCK-IN / CLOCK-OUT REMINDERS — approved use case #3
// ============================================

interface ClockInReminderSMSData {
  employeeName: string
  employeePhone: string
  startTime: string
}

export async function sendClockInReminderSMS(data: ClockInReminderSMSData): Promise<{ success: boolean; error?: string }> {
  const body = compose(
    `Playfunia Staff Reminder: Hi ${data.employeeName}, your shift started at ${data.startTime} but you haven't clocked in. Please clock in as soon as possible.`
  )
  return sendSMS({ to: data.employeePhone, body, messageType: 'clock_in_reminder' })
}

interface ClockOutReminderSMSData {
  employeeName: string
  employeePhone: string
  endTime: string
}

export async function sendClockOutReminderSMS(data: ClockOutReminderSMSData): Promise<{ success: boolean; error?: string }> {
  const body = compose(
    `Playfunia Staff Reminder: Hi ${data.employeeName}, your shift ended at ${data.endTime} but you haven't clocked out. Please clock out as soon as possible.`
  )
  return sendSMS({ to: data.employeePhone, body, messageType: 'clock_out_reminder' })
}
