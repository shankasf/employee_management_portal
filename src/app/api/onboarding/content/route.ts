import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

// GET ?business_id=X — content list for that business + own progress
export async function GET(request: Request) {
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const businessId = Number(url.searchParams.get('business_id'))
  if (!businessId) return NextResponse.json({ error: 'business_id required' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createServiceClient()) as any

  // Verify employee is assigned to this business
  const { data: assignment } = await supabase
    .from('employee_businesses')
    .select('business_id')
    .eq('employee_id', user.id)
    .eq('business_id', businessId)
    .maybeSingle()

  if (!assignment) {
    return NextResponse.json({ error: 'Not assigned to this business' }, { status: 403 })
  }

  const [{ data: business }, { data: content, error: cErr }, { data: progress, error: pErr }, { data: completion }] = await Promise.all([
    supabase.from('businesses').select('id, name, location').eq('id', businessId).single(),
    supabase
      .from('onboarding_content')
      .select('id, business_id, type, subtype, title, description, content_url, content_text, file_size, duration_seconds, is_required, sort_order, created_at')
      .eq('business_id', businessId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase
      .from('onboarding_progress')
      .select('content_id, max_watched_pct, completed_at')
      .eq('employee_id', user.id),
    supabase
      .from('onboarding_completions')
      .select('completed_at, business_id')
      .eq('employee_id', user.id)
      .eq('business_id', businessId)
      .maybeSingle(),
  ])

  if (cErr || pErr) {
    console.error('[onboarding content GET]', { cErr, pErr })
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 })
  }

  const progressByContent = new Map<string, { max_watched_pct: number; completed_at: string | null }>()
  for (const p of (progress as Array<{ content_id: string; max_watched_pct: number; completed_at: string | null }>) || []) {
    progressByContent.set(p.content_id, { max_watched_pct: Number(p.max_watched_pct), completed_at: p.completed_at })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = ((content as any[]) || []).map((c: any) => ({
    ...c,
    progress: progressByContent.get(c.id) || { max_watched_pct: 0, completed_at: null },
  }))

  return NextResponse.json({
    business,
    items,
    completion: completion || null,
  })
}
