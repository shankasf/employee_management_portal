import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  sendEventAssignedEmail,
  sendEventRemovedEmail,
} from '@/lib/email'
import { formatDate, formatTime } from '@/lib/utils'
import { getEmployeeRecipient } from '@/lib/recipients'

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
      .select('role, admin_scoped')
      .eq('id', user.id)
      .single()

    const _p = profile as { role: string; admin_scoped?: boolean } | null
    if (_p?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden - Admin only' }, { status: 403 })
    }
    // Events are company-wide; not available to scoped (location) admins.
    if (_p?.admin_scoped) {
      return NextResponse.json({ error: 'Forbidden - company-wide function' }, { status: 403 })
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

    const recipient = await getEmployeeRecipient(employeeId)
    if (!recipient) {
      return NextResponse.json({ success: true, skipped: 'inactive_employee' })
    }
    const employeeEmail = recipient.email
    const employeeName = recipient.displayName || recipient.fullName

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
        employeeName,
        employeeEmail,
        eventTitle: eventData.title,
        eventDate,
        eventTime,
        room: eventData.room || undefined,
        role: role || 'Staff',
      })
    } else if (type === 'event_removed') {
      result = await sendEventRemovedEmail({
        employeeName,
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
      error: 'Internal server error'
    }, { status: 500 })
  }
}
