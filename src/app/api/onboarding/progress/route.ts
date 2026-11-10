import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { logActivity, getRequestInfo } from '@/lib/activity-log'

// POST — upsert progress for a content item.
// Body: { content_id, watched_pct?: 0..100, mark_complete?: boolean }
// Server enforces: complete only if watched_pct >= 90 (videos) OR type != video (docs/articles).
export async function POST(request: Request) {
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { ipAddress, userAgent } = getRequestInfo(request.headers)

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const contentId = body.content_id ? String(body.content_id) : null
  const watchedPctRaw = body.watched_pct
  const markComplete = body.mark_complete === true

  if (!contentId) return NextResponse.json({ error: 'content_id required' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createServiceClient()) as any

  // Load content row to validate access & rules
  const { data: content, error: cErr } = await supabase
    .from('onboarding_content')
    .select('id, business_id, type, title, businesses(name, location)')
    .eq('id', contentId)
    .single()

  if (cErr || !content) return NextResponse.json({ error: 'Content not found' }, { status: 404 })

  // Verify user is assigned to this content's business
  const { data: assignment } = await supabase
    .from('employee_businesses')
    .select('business_id')
    .eq('employee_id', user.id)
    .eq('business_id', content.business_id)
    .maybeSingle()

  if (!assignment) {
    return NextResponse.json({ error: 'Not assigned to this business' }, { status: 403 })
  }

  // Load existing progress
  const { data: existing } = await supabase
    .from('onboarding_progress')
    .select('id, max_watched_pct, completed_at')
    .eq('employee_id', user.id)
    .eq('content_id', contentId)
    .maybeSingle()

  let nextMaxWatched: number = existing?.max_watched_pct ? Number(existing.max_watched_pct) : 0
  if (typeof watchedPctRaw === 'number' && Number.isFinite(watchedPctRaw)) {
    const clamped = Math.max(0, Math.min(100, watchedPctRaw))
    if (clamped > nextMaxWatched) nextMaxWatched = clamped
  }

  let completedAt: string | null = existing?.completed_at || null
  if (markComplete && !completedAt) {
    if (content.type === 'video' && nextMaxWatched < 90) {
      return NextResponse.json({
        error: 'Must watch at least 90% of the video before completing',
        max_watched_pct: nextMaxWatched,
      }, { status: 400 })
    }
    completedAt = new Date().toISOString()
  }

  const wasAlreadyComplete = !!existing?.completed_at
  const isNowComplete = !!completedAt
  const justCompleted = !wasAlreadyComplete && isNowComplete

  if (existing) {
    const { error } = await supabase
      .from('onboarding_progress')
      .update({ max_watched_pct: nextMaxWatched, completed_at: completedAt })
      .eq('id', existing.id)
    if (error) {
      console.error('[onboarding progress UPDATE]', error)
      return NextResponse.json({ error: 'Failed to save progress' }, { status: 500 })
    }
  } else {
    const { error } = await supabase
      .from('onboarding_progress')
      .insert({
        employee_id: user.id,
        content_id: contentId,
        max_watched_pct: nextMaxWatched,
        completed_at: completedAt,
      })
    if (error) {
      console.error('[onboarding progress INSERT]', error)
      return NextResponse.json({ error: 'Failed to save progress' }, { status: 500 })
    }
  }

  if (justCompleted) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = content as any
    const biz = c.businesses
    const bizLabel = biz ? (biz.location ? `${biz.name} — ${biz.location}` : biz.name) : `Business #${content.business_id}`

    // Look up employee name/email so the log row reads naturally
    const { data: emp } = await supabase
      .from('employees')
      .select('display_name, profiles!inner(full_name, email)')
      .eq('id', user.id)
      .maybeSingle()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const empAny = emp as any
    const employeeName = empAny?.display_name || empAny?.profiles?.full_name || 'Employee'
    const employeeEmail = empAny?.profiles?.email || user.email || 'unknown'

    logActivity({
      adminId: user.id,
      adminEmail: employeeEmail,
      action: 'onboarding_item_completed',
      entityType: 'onboarding_content',
      entityId: content.id,
      entityName: content.title,
      details: {
        employee_id: user.id,
        employee_name: employeeName,
        business_id: content.business_id,
        business_label: bizLabel,
        content_type: content.type,
        max_watched_pct: nextMaxWatched,
      },
      ipAddress,
      userAgent,
    })
  }

  return NextResponse.json({
    success: true,
    max_watched_pct: nextMaxWatched,
    completed_at: completedAt,
  })
}
