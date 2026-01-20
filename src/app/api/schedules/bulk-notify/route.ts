import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendBulkSchedulesCreatedNotification } from '@/lib/email'
import { formatDate, formatTime } from '@/lib/utils'

interface BulkNotifyRequest {
  employeeId: string
  employeeName: string
  scheduleCount: number
  startDate: string
  endDate: string
  days: string[]
  startTime: string
  endTime: string
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
    const { employeeName, scheduleCount, startDate, endDate, days, startTime, endTime } = body

    if (!employeeName || !scheduleCount || !startDate || !endDate || !days?.length) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const result = await sendBulkSchedulesCreatedNotification({
      employeeName,
      scheduleCount,
      startDate: formatDate(startDate),
      endDate: formatDate(endDate),
      days,
      startTime: formatTime(`2000-01-01T${startTime}`),
      endTime: formatTime(`2000-01-01T${endTime}`),
    })

    return NextResponse.json({
      success: true,
      emailSent: result.success,
    })

  } catch (error) {
    console.error('Error sending bulk schedule notification:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
