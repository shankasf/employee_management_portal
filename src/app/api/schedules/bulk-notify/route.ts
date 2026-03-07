import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendBulkSchedulesCreatedNotification } from '@/lib/email'
import { sendBulkSchedulesCreatedSMS } from '@/lib/sms'
import { formatDateOnly, formatTimeString } from '@/lib/utils'

interface BulkNotifyRequest {
  employeeId: string
  employeeName: string
  scheduleCount: number
  startDate: string
  endDate: string
  days: string[]
  startTime: string
  endTime: string
  dayTimes?: Record<string, { start_time: string; end_time: string }>
}

export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify user is admin
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if ((profile as { role: string } | null)?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden - Admin only' }, { status: 403 })
    }

    const body: BulkNotifyRequest = await request.json()
    const { employeeName, scheduleCount, startDate, endDate, days, startTime, endTime, dayTimes } = body

    if (!employeeName || !scheduleCount || !startDate || !endDate || !days?.length || !startTime || !endTime) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Format per-day times if provided
    let formattedDayTimes: Record<string, { start_time: string; end_time: string }> | undefined
    if (dayTimes) {
      formattedDayTimes = {}
      for (const [day, times] of Object.entries(dayTimes)) {
        formattedDayTimes[day] = {
          start_time: formatTimeString(times.start_time),
          end_time: formatTimeString(times.end_time),
        }
      }
    }

    const result = await sendBulkSchedulesCreatedNotification({
      employeeName,
      scheduleCount,
      startDate: formatDateOnly(startDate),
      endDate: formatDateOnly(endDate),
      days,
      startTime: formatTimeString(startTime),
      endTime: formatTimeString(endTime),
      dayTimes: formattedDayTimes,
    })

    // Send SMS notification to admins (non-blocking)
    sendBulkSchedulesCreatedSMS({
      employeeName,
      scheduleCount,
      startDate: formatDateOnly(startDate),
      endDate: formatDateOnly(endDate),
    }).catch(err => console.error('Failed to send bulk schedule SMS:', err))

    return NextResponse.json({
      success: true,
      emailSent: result.success,
    })

  } catch (error) {
    console.error('Error sending bulk schedule notification:', error)
    return NextResponse.json({
      error: 'Internal server error'
    }, { status: 500 })
  }
}
