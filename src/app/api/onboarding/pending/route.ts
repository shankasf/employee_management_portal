import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

interface AssignmentRow {
  business_id: number
  businesses: { id: number; name: string; location: string | null } | null
}

interface ContentRow {
  id: string
  business_id: number
  type: string
  subtype: string | null
  title: string
  is_required: boolean
  created_at: string
}

interface ProgressRow {
  content_id: string
  max_watched_pct: number
  completed_at: string | null
}

// GET — pending training summary for the current employee.
// Returns counts of unstarted (new) and in-progress required items across all
// assigned businesses, plus the most recently added unstarted items so the
// employee dashboard can surface them.
export async function GET() {
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createServiceClient()) as any

  const { data: assignments, error: aErr } = await supabase
    .from('employee_businesses')
    .select('business_id, businesses(id, name, location)')
    .eq('employee_id', user.id)

  if (aErr) {
    console.error('[onboarding pending] assignments', aErr)
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 })
  }

  const businessRows = (assignments as AssignmentRow[] || []).filter(a => a.businesses)
  const businessIds = businessRows.map(a => a.businesses!.id)

  if (businessIds.length === 0) {
    return NextResponse.json({
      new_count: 0,
      in_progress_count: 0,
      total_pending: 0,
      items: [],
    })
  }

  const businessNameById = new Map<number, string>()
  for (const a of businessRows) businessNameById.set(a.businesses!.id, a.businesses!.name)

  const [{ data: content, error: cErr }, { data: progress, error: pErr }] = await Promise.all([
    supabase
      .from('onboarding_content')
      .select('id, business_id, type, subtype, title, is_required, created_at')
      .in('business_id', businessIds)
      .eq('is_required', true),
    supabase
      .from('onboarding_progress')
      .select('content_id, max_watched_pct, completed_at')
      .eq('employee_id', user.id),
  ])

  if (cErr || pErr) {
    console.error('[onboarding pending]', { cErr, pErr })
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 })
  }

  const progressByContent = new Map<string, ProgressRow>()
  for (const p of (progress as ProgressRow[]) || []) {
    progressByContent.set(p.content_id, p)
  }

  let newCount = 0
  let inProgressCount = 0
  const unstarted: Array<ContentRow & { business_name: string }> = []

  for (const c of (content as ContentRow[]) || []) {
    const p = progressByContent.get(c.id)
    if (!p || (!p.completed_at && Number(p.max_watched_pct) <= 0)) {
      newCount += 1
      unstarted.push({ ...c, business_name: businessNameById.get(c.business_id) || '' })
    } else if (!p.completed_at) {
      inProgressCount += 1
    }
  }

  unstarted.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))

  const items = unstarted.slice(0, 3).map(c => ({
    id: c.id,
    business_id: c.business_id,
    business_name: c.business_name,
    type: c.type,
    subtype: c.subtype,
    title: c.title,
  }))

  return NextResponse.json({
    new_count: newCount,
    in_progress_count: inProgressCount,
    total_pending: newCount + inProgressCount,
    items,
  })
}
