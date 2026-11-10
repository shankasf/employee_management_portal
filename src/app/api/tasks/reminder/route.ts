import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendTaskReminderEmail } from '@/lib/email'
import { getEmployeeRecipient } from '@/lib/recipients'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { taskNames } = body

    // Validate taskNames
    if (!Array.isArray(taskNames) || taskNames.length === 0) {
      return NextResponse.json({ error: 'taskNames must be a non-empty array' }, { status: 400 })
    }

    if (taskNames.length > 50) {
      return NextResponse.json({ error: 'taskNames exceeds maximum of 50 items' }, { status: 400 })
    }

    if (!taskNames.every((name: unknown) => typeof name === 'string' && name.length > 0)) {
      return NextResponse.json({ error: 'All taskNames must be non-empty strings' }, { status: 400 })
    }

    const recipient = await getEmployeeRecipient(user.id)
    if (!recipient) {
      return NextResponse.json({ success: true, skipped: 'inactive_employee' })
    }

    // Use email from auth session (not from request body - prevents spoofing)
    if (!user.email) {
      return NextResponse.json({ error: 'No email associated with account' }, { status: 400 })
    }

    const result = await sendTaskReminderEmail({
      employeeName: recipient.displayName || recipient.fullName,
      employeeEmail: user.email,
      taskNames: taskNames as string[],
    })

    return NextResponse.json({
      success: true,
      emailSent: result.success,
    })
  } catch (error) {
    console.error('Error sending task reminder:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
