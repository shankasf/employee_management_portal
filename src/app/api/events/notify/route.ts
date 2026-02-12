import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  sendEventAssignedEmail,
  sendEventRemovedEmail,
} from '@/lib/email'
import {
  sendEventAssignedSMS,
  sendEventRemovedSMS,
} from '@/lib/sms'
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

    // Verify user is admin (only admins can send event notifications)
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if ((profile as { role: string } | null)?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden - Admin only' }, { status: 403 })
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
    const employeePhone = employee.phone_number

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
      // Send SMS if phone available
      if (employeePhone) {
        sendEventAssignedSMS({
          employeeName: employee.display_name || 'Employee',
          employeePhone,
          eventTitle: eventData.title,
          eventDate,
          eventTime,
          room: eventData.room || undefined,
          role: role || 'Staff',
        }).catch(err => console.error('Failed to send event assigned SMS:', err))
      }
    } else if (type === 'event_removed') {
      result = await sendEventRemovedEmail({
        employeeName: employee.display_name || 'Employee',
        employeeEmail,
        eventTitle: eventData.title,
        eventDate,
      })
      // Send SMS if phone available
      if (employeePhone) {
        sendEventRemovedSMS({
          employeeName: employee.display_name || 'Employee',
          employeePhone,
          eventTitle: eventData.title,
          eventDate,
        }).catch(err => console.error('Failed to send event removed SMS:', err))
      }
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
      error: 'Internal server error'
    }, { status: 500 })
  }
}
