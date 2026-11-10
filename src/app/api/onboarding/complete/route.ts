import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { sendOnboardingCompletionEmail } from '@/lib/email'
import { logActivity, getRequestInfo } from '@/lib/activity-log'

// POST — finalize onboarding for a business.
// Validates all required items have completed_at; creates onboarding_completions row;
// sends admin email notification.
export async function POST(request: Request) {
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { ipAddress, userAgent } = getRequestInfo(request.headers)

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const businessId = body.business_id != null ? Number(body.business_id) : null
  if (!businessId) return NextResponse.json({ error: 'business_id required' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createServiceClient()) as any

  // Verify assignment
  const { data: assignment } = await supabase
    .from('employee_businesses')
    .select('business_id')
    .eq('employee_id', user.id)
    .eq('business_id', businessId)
    .maybeSingle()

  if (!assignment) {
    return NextResponse.json({ error: 'Not assigned to this business' }, { status: 403 })
  }

  // Already completed?
  const { data: existing } = await supabase
    .from('onboarding_completions')
    .select('id, completed_at, notified_at')
    .eq('employee_id', user.id)
    .eq('business_id', businessId)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ success: true, completed_at: existing.completed_at, already: true })
  }

  // Validate: every required content item has a completed_at progress row
  const { data: required, error: rErr } = await supabase
    .from('onboarding_content')
    .select('id')
    .eq('business_id', businessId)
    .eq('is_required', true)

  if (rErr) return NextResponse.json({ error: 'Failed to validate' }, { status: 500 })

  const requiredIds = ((required as Array<{ id: string }>) || []).map(r => r.id)

  if (requiredIds.length > 0) {
    const { data: completedProgress } = await supabase
      .from('onboarding_progress')
      .select('content_id, completed_at')
      .eq('employee_id', user.id)
      .in('content_id', requiredIds)

    const completedSet = new Set(
      ((completedProgress as Array<{ content_id: string; completed_at: string | null }>) || [])
        .filter(p => p.completed_at)
        .map(p => p.content_id)
    )

    const missing = requiredIds.filter(id => !completedSet.has(id))
    if (missing.length > 0) {
      return NextResponse.json({
        error: `Cannot complete: ${missing.length} required item${missing.length === 1 ? '' : 's'} still pending`,
        missing_count: missing.length,
      }, { status: 400 })
    }
  }

  // Insert completion
  const completedAt = new Date().toISOString()
  const { error: insErr } = await supabase
    .from('onboarding_completions')
    .insert({
      employee_id: user.id,
      business_id: businessId,
      completed_at: completedAt,
      acknowledged_by_admin: false,
    })

  if (insErr) {
    console.error('[onboarding complete INSERT]', insErr)
    return NextResponse.json({ error: 'Failed to save completion' }, { status: 500 })
  }

  // Look up details for the notification
  const [{ data: business }, { data: emp }] = await Promise.all([
    supabase.from('businesses').select('name, location').eq('id', businessId).single(),
    supabase
      .from('employees')
      .select('display_name, profiles!inner(full_name, email)')
      .eq('id', user.id)
      .single(),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const empAny = emp as any
  const employeeName = empAny?.display_name || empAny?.profiles?.full_name || 'Employee'
  const employeeEmail = empAny?.profiles?.email || ''
  const bizLabel = business
    ? (business.location ? `${business.name} — ${business.location}` : business.name)
    : `Business #${businessId}`

  // Log the finalization itself (employee is the actor)
  logActivity({
    adminId: user.id,
    adminEmail: employeeEmail || user.email || 'unknown',
    action: 'onboarding_completed',
    entityType: 'onboarding_completion',
    entityId: `${user.id}:${businessId}`,
    entityName: `${employeeName} — ${bizLabel}`,
    details: {
      employee_id: user.id,
      employee_name: employeeName,
      business_id: businessId,
      business_label: bizLabel,
      total_required: requiredIds.length,
      completed_at: completedAt,
    },
    ipAddress,
    userAgent,
  })

  // Fire email (best-effort; don't fail completion if email fails)
  try {
    const result = await sendOnboardingCompletionEmail({
      employeeName,
      employeeEmail,
      businessName: business?.name || 'Company',
      businessLocation: business?.location || null,
      completedAt,
      totalRequired: requiredIds.length,
    })
    if (result.success) {
      await supabase
        .from('onboarding_completions')
        .update({ notified_at: new Date().toISOString() })
        .eq('employee_id', user.id)
        .eq('business_id', businessId)
      logActivity({
        adminId: null,
        adminEmail: 'system',
        action: 'onboarding_completion_email_sent',
        entityType: 'onboarding_completion',
        entityId: `${user.id}:${businessId}`,
        entityName: `${employeeName} — ${bizLabel}`,
        details: { employee_email: employeeEmail, business_id: businessId },
      })
    } else {
      console.error('[onboarding complete email failed]', result.error)
      logActivity({
        adminId: null,
        adminEmail: 'system',
        action: 'onboarding_completion_email_failed',
        entityType: 'onboarding_completion',
        entityId: `${user.id}:${businessId}`,
        entityName: `${employeeName} — ${bizLabel}`,
        details: { error: result.error || 'Unknown error', business_id: businessId },
      })
    }
  } catch (e) {
    console.error('[onboarding complete email]', e)
    logActivity({
      adminId: null,
      adminEmail: 'system',
      action: 'onboarding_completion_email_failed',
      entityType: 'onboarding_completion',
      entityId: `${user.id}:${businessId}`,
      entityName: `${employeeName} — ${bizLabel}`,
      details: { error: e instanceof Error ? e.message : 'Unknown error', business_id: businessId },
    })
  }

  return NextResponse.json({ success: true, completed_at: completedAt })
}
