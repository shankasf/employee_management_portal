import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendPolicyEmail } from '@/lib/email'
import { sendPolicySMS } from '@/lib/sms'

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
      .select('role')
      .eq('id', user.id)
      .single()

    if ((authProfile as { role: string } | null)?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden - Admin only' }, { status: 403 })
    }

    const { policyId, employeeId } = await request.json()

    if (!policyId || !employeeId) {
      return NextResponse.json(
        { error: 'Policy ID and Employee ID are required' },
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
        { error: 'Policy not found' },
        { status: 404 }
      )
    }

    const policy = policyData as PolicyData

    // Fetch employee details
    const { data: employee, error: employeeError } = await supabase
      .from('employees')
      .select(`
        id,
        phone_number,
        profiles!inner (
          id,
          full_name,
          email
        )
      `)
      .eq('id', employeeId)
      .single()

    if (employeeError || !employee) {
      return NextResponse.json(
        { error: 'Employee not found' },
        { status: 404 }
      )
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const employeeData = employee as any
    const empProfile = employeeData.profiles
    const employeeName = empProfile?.full_name || 'Employee'
    const employeeEmail = empProfile?.email
    const employeePhone = employeeData.phone_number

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

    // Send SMS if phone available
    if (employeePhone) {
      sendPolicySMS({
        employeeName,
        employeePhone,
        policyTitle: policy.title,
      }).catch(err => console.error('Failed to send policy SMS:', err))
    }

    return NextResponse.json({
      success: true,
      message: `Policy sent to ${employeeName}`
    })
  } catch (error) {
    console.error('Error sending policy:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
