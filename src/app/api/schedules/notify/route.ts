import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  sendScheduleAssignedEmail,
  sendScheduleConfirmedEmail,
  sendCancellationRequestEmail,
  sendCancellationApprovedEmail,
  sendAdminCancelledEmail,
  sendScheduleDeletedEmail,
} from '@/lib/email'
import {
  sendScheduleAssignedSMS,
  sendScheduleConfirmedSMS,
  sendCancellationRequestSMS,
  sendCancellationApprovedSMS,
  sendAdminCancelledSMS,
  sendScheduleDeletedSMS,
} from '@/lib/sms'
import { formatDate, formatTimeString } from '@/lib/utils'

type NotificationType =
  | 'schedule_assigned'
  | 'schedule_confirmed'
  | 'cancellation_requested'
  | 'cancellation_approved'
  | 'admin_cancelled'
  | 'schedule_deleted'

interface NotifyRequest {
  scheduleId: string
  type: NotificationType
  reason?: string
}

export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify user is admin for admin-only notification types
    const body: NotifyRequest = await request.json()
    const adminOnlyTypes: NotificationType[] = ['cancellation_approved', 'admin_cancelled', 'schedule_deleted', 'schedule_assigned']
    if (adminOnlyTypes.includes(body.type)) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      if ((profile as { role: string } | null)?.role !== 'admin') {
        return NextResponse.json({ error: 'Forbidden - Admin only' }, { status: 403 })
      }
    }
    const { scheduleId, type, reason } = body

    if (!scheduleId || !type) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Get schedule with employee details
    const { data: schedule, error: scheduleError } = await supabase
      .from('schedules')
      .select(`
        *,
        employee:employees (
          id,
          display_name,
          phone_number,
          profiles (
            email,
            full_name
          )
        )
      `)
      .eq('id', scheduleId)
      .single()

    if (scheduleError || !schedule) {
      return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scheduleData = schedule as any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const employee = scheduleData.employee as any
    const employeeName = employee?.display_name || employee?.profiles?.full_name || 'Employee'
    const employeeEmail = employee?.profiles?.email
    const employeePhone = employee?.phone_number

    // For employee-initiated actions, verify the requesting user owns this schedule
    const employeeOnlyTypes: NotificationType[] = ['schedule_confirmed', 'cancellation_requested']
    if (employeeOnlyTypes.includes(type)) {
      const { data: empRecord } = await supabase
        .from('employees')
        .select('id')
        .eq('profile_id', user.id)
        .single()
      if (!empRecord || (empRecord as { id: string }).id !== scheduleData.employee_id) {
        return NextResponse.json({ error: 'Forbidden - Not your schedule' }, { status: 403 })
      }
    }

    if (!employeeEmail && type !== 'cancellation_requested') {
      return NextResponse.json({ error: 'Employee email not found' }, { status: 400 })
    }

    const scheduleDate = formatDate(scheduleData.schedule_date)
    const startTime = formatTimeString(scheduleData.start_time)
    const endTime = formatTimeString(scheduleData.end_time)

    let result: { success: boolean; error?: string } = { success: false }

    let smsResult: { success: boolean; error?: string } = { success: false }

    switch (type) {
      case 'schedule_assigned':
        result = await sendScheduleAssignedEmail({
          employeeName,
          employeeEmail: employeeEmail!,
          scheduleDate,
          startTime,
          endTime,
          notes: scheduleData.description || undefined,
        })
        // Send SMS if phone available
        if (employeePhone) {
          smsResult = await sendScheduleAssignedSMS({
            employeeName,
            employeePhone,
            scheduleDate,
            startTime,
            endTime,
            notes: scheduleData.description || undefined,
          })
        }
        break

      case 'schedule_confirmed':
        result = await sendScheduleConfirmedEmail({
          employeeName,
          employeeEmail: employeeEmail!,
          scheduleDate,
          startTime,
          endTime,
        })
        // Send SMS if phone available
        if (employeePhone) {
          smsResult = await sendScheduleConfirmedSMS({
            employeeName,
            employeePhone,
            scheduleDate,
            startTime,
            endTime,
          })
        }
        break

      case 'cancellation_requested':
        result = await sendCancellationRequestEmail({
          employeeName,
          scheduleDate,
          startTime,
          endTime,
          reason: reason || scheduleData.cancellation_reason || 'No reason provided',
        })
        // Send SMS to admins
        smsResult = await sendCancellationRequestSMS({
          employeeName,
          scheduleDate,
          startTime,
          endTime,
          reason: reason || scheduleData.cancellation_reason || 'No reason provided',
        })
        break

      case 'cancellation_approved':
        result = await sendCancellationApprovedEmail({
          employeeName,
          employeeEmail: employeeEmail!,
          scheduleDate,
          startTime,
          endTime,
        })
        // Send SMS if phone available
        if (employeePhone) {
          smsResult = await sendCancellationApprovedSMS({
            employeeName,
            employeePhone,
            scheduleDate,
            startTime,
            endTime,
          })
        }
        break

      case 'admin_cancelled':
        result = await sendAdminCancelledEmail({
          employeeName,
          employeeEmail: employeeEmail!,
          scheduleDate,
          startTime,
          endTime,
          reason: reason || scheduleData.cancellation_reason || undefined,
        })
        // Send SMS if phone available
        if (employeePhone) {
          smsResult = await sendAdminCancelledSMS({
            employeeName,
            employeePhone,
            scheduleDate,
            startTime,
            endTime,
            reason: reason || scheduleData.cancellation_reason || undefined,
          })
        }
        break

      case 'schedule_deleted':
        result = await sendScheduleDeletedEmail({
          employeeName,
          employeeEmail: employeeEmail!,
          scheduleDate,
          startTime,
          endTime,
          reason: reason || undefined,
        })
        // Send SMS if phone available
        if (employeePhone) {
          smsResult = await sendScheduleDeletedSMS({
            employeeName,
            employeePhone,
            scheduleDate,
            startTime,
            endTime,
            reason: reason || undefined,
          })
        }
        break

      default:
        return NextResponse.json({ error: 'Invalid notification type' }, { status: 400 })
    }

    if (!smsResult.success && employeePhone) {
      console.error('SMS send failed:', smsResult.error)
    }

    if (!result.success) {
      console.error('Email send failed:', result.error)
      // Don't fail the request, just log it
    }

    // Log the email in the database (using any to bypass type checking for dynamic table)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('schedule_email_logs').insert({
      schedule_id: scheduleId,
      email_type: type,
      recipient_email: employeeEmail || 'managers',
      recipient_type: type === 'schedule_confirmed' || type === 'cancellation_requested' ? 'manager' : 'employee',
      status: result.success ? 'sent' : 'failed',
      error_message: result.error || null,
    }).catch((err: Error) => console.error('Failed to log email:', err))

    return NextResponse.json({
      success: true,
      emailSent: result.success,
      smsSent: smsResult.success,
    })

  } catch (error) {
    console.error('Error sending notification:', error)
    return NextResponse.json({
      error: 'Internal server error'
    }, { status: 500 })
  }
}
