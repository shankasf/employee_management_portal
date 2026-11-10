import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendPolicyEmail } from '@/lib/email'
import { getEmployeeRecipient } from '@/lib/recipients'

interface PolicyData {
  id: string
  title: string
  content: string
  category: string | null
  image_url: string | null
  video_url: string | null
}

export async function POST(request: Request) {
  try {
    // Verify user is authenticated and is admin
    const { createClient } = await import('@/lib/supabase/server')
    const authSupabase = await createClient()
    const { data: { user } } = await authSupabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: authProfile } = await authSupabase
      .from('profiles')
      .select('role, admin_scoped')
      .eq('id', user.id)
      .single()

    const _p = authProfile as { role: string; admin_scoped?: boolean } | null
    if (_p?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden - Admin only' }, { status: 403 })
    }
    // Important Messages are company-wide; not available to scoped admins.
    if (_p?.admin_scoped) {
      return NextResponse.json({ error: 'Forbidden - company-wide function' }, { status: 403 })
    }

    const { policyId, employeeId } = await request.json()

    if (!policyId || !employeeId) {
      return NextResponse.json(
        { error: 'Message ID and Employee ID are required' },
        { status: 400 }
      )
    }

    const supabase = await createServiceClient()

    // Fetch policy details
    const { data: policyData, error: policyError } = await supabase
      .from('policy_strips')
      .select('id, title, content, category, image_url, video_url')
      .eq('id', policyId)
      .single()

    if (policyError || !policyData) {
      return NextResponse.json(
        { error: 'Message not found' },
        { status: 404 }
      )
    }

    const policy = policyData as PolicyData

    const recipient = await getEmployeeRecipient(employeeId)
    if (!recipient) {
      return NextResponse.json({ success: true, skipped: 'inactive_employee' })
    }
    const employeeName = recipient.fullName
    const employeeEmail = recipient.email

    if (!employeeEmail) {
      return NextResponse.json(
        { error: 'Employee email not found' },
        { status: 400 }
      )
    }

    // Send email
    const result = await sendPolicyEmail({
      employeeName,
      employeeEmail,
      policyTitle: policy.title,
      policyContent: policy.content,
      policyCategory: policy.category || undefined,
      imageUrl: policy.image_url || undefined,
      videoUrl: policy.video_url || undefined,
    })

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to send email' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: `Message sent to ${employeeName}`
    })
  } catch (error) {
    console.error('Error sending policy:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
