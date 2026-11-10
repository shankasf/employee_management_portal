import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

interface AssignmentRow {
  business_id: number
  businesses: { id: number; name: string; location: string | null } | null
}

// GET — list businesses the current employee is assigned to, with completion + progress
export async function GET() {
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createServiceClient()) as any

  const [
    { data: assignments, error: aErr },
    { data: content, error: cErr },
    { data: progress, error: pErr },
    { data: completions, error: compErr },
  ] = await Promise.all([
    supabase
      .from('employee_businesses')
      .select('business_id, businesses(id, name, location)')
      .eq('employee_id', user.id),
    supabase
      .from('onboarding_content')
      .select('id, business_id, is_required'),
    supabase
      .from('onboarding_progress')
      .select('content_id, completed_at')
      .eq('employee_id', user.id),
    supabase
      .from('onboarding_completions')
      .select('business_id, completed_at')
      .eq('employee_id', user.id),
  ])

  if (aErr || cErr || pErr || compErr) {
    console.error('[onboarding businesses]', { aErr, cErr, pErr, compErr })
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 })
  }

  // Index content by business
  const requiredByBusiness = new Map<number, Set<string>>()
  for (const c of (content as Array<{ id: string; business_id: number; is_required: boolean }>) || []) {
    if (!c.is_required) continue
    if (!requiredByBusiness.has(c.business_id)) requiredByBusiness.set(c.business_id, new Set())
    requiredByBusiness.get(c.business_id)!.add(c.id)
  }

  const completedContentIds = new Set<string>()
  for (const p of (progress as Array<{ content_id: string; completed_at: string | null }>) || []) {
    if (p.completed_at) completedContentIds.add(p.content_id)
  }

  const completionByBusiness = new Map<number, string>()
  for (const c of (completions as Array<{ business_id: number; completed_at: string }>) || []) {
    completionByBusiness.set(c.business_id, c.completed_at)
  }

  const result = ((assignments as AssignmentRow[]) || [])
    .filter(a => a.businesses)
    .map(a => {
      const biz = a.businesses!
      const required = requiredByBusiness.get(biz.id) || new Set<string>()
      const requiredTotal = required.size
      let requiredCompleted = 0
      required.forEach(id => { if (completedContentIds.has(id)) requiredCompleted += 1 })
      const progressPct = requiredTotal === 0 ? 100 : Math.round((requiredCompleted / requiredTotal) * 100)
      return {
        business_id: biz.id,
        name: biz.name,
        location: biz.location,
        required_total: requiredTotal,
        required_completed: requiredCompleted,
        progress_pct: progressPct,
        is_completed: completionByBusiness.has(biz.id),
        completed_at: completionByBusiness.get(biz.id) || null,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name) || (a.location || '').localeCompare(b.location || ''))

  return NextResponse.json({ businesses: result })
}
