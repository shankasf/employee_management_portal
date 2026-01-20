import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  sendEventAssignedEmail,
  sendEventRemovedEmail,
} from '@/lib/email'
import { formatDate, formatTime } from '@/lib/utils'

type NotificationType = 'event_assigned' | 'event_removed'

interface NotifyRequest {
  eventId: string
  employeeId: string
  type: NotificationType
  role?: string
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
    const { eventId, employeeId, type, role } = body

    if (!eventId || !employeeId || !type) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Get event details
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('*')
      .eq('id', eventId)
      .single()

    if (eventError || !event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eventData = event as any

    // Get employee details
    const { data: employeeData, error: employeeError } = await supabase
      .from('employees')
      .select('*, profiles(email)')
      .eq('id', employeeId)
      .single()

    if (employeeError || !employeeData) {
      return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const employee = employeeData as any
    const employeeEmail = employee.profiles?.email

    if (!employeeEmail) {
      return NextResponse.json({ error: 'Employee email not found' }, { status: 400 })
    }

    const eventDate = formatDate(eventData.start_time)
    const startTime = formatTime(eventData.start_time)
    const endTime = eventData.end_time ? formatTime(eventData.end_time) : ''
    const eventTime = endTime ? `${startTime} - ${endTime}` : startTime

    let result: { success: boolean; error?: string } = { success: false }

    if (type === 'event_assigned') {
      result = await sendEventAssignedEmail({
        employeeName: employee.display_name || 'Employee',
        employeeEmail,
        eventTitle: eventData.title,
        eventDate,
        eventTime,
        room: eventData.room || undefined,
        role: role || 'Staff',
      })
    } else if (type === 'event_removed') {
      result = await sendEventRemovedEmail({
        employeeName: employee.display_name || 'Employee',
        employeeEmail,
        eventTitle: eventData.title,
        eventDate,
      })
    } else {
      return NextResponse.json({ error: 'Invalid notification type' }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      emailSent: result.success,
    })

  } catch (error) {
    console.error('Error sending event notification:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
