import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

// GET ?q=term&business_id=optional
// Searches onboarding_content (filtered to user's businesses) + active policy_strips.
// Returns ranked hits with title, preview, kind, and link target.
export async function GET(request: Request) {
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const qRaw = (url.searchParams.get('q') || '').trim()
  if (qRaw.length < 2) return NextResponse.json({ results: [] })
  const q = qRaw.slice(0, 200) // cap input length

  // Strip chars that confuse PostgREST's `.or()` grammar (commas split conditions;
  // parentheses, dots, double quotes, and backslashes are also reserved).
  // Also escape SQL LIKE wildcards `%` and `_` so they're treated as literals.
  const sanitized = q.replace(/[",()\\.]/g, ' ').replace(/\s+/g, ' ').trim()
  if (sanitized.length < 2) return NextResponse.json({ results: [] })
  const ilike = `%${sanitized.replace(/[%_]/g, '\\$&')}%`

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createServiceClient()) as any

  // Limit onboarding search to businesses the user is assigned to
  const { data: assignments } = await supabase
    .from('employee_businesses')
    .select('business_id')
    .eq('employee_id', user.id)

  const businessIds = ((assignments as Array<{ business_id: number }>) || []).map(a => a.business_id)

  type OnboardingHit = {
    id: string; type: string; subtype: string | null; title: string; description: string | null
    content_text: string | null; business_id: number
    businesses: { name: string; location: string | null } | null
  }
  type PolicyHit = {
    id: string; title: string; content: string; category: string | null
  }

  const onboardingPromise = businessIds.length === 0
    ? Promise.resolve({ data: [] as OnboardingHit[], error: null })
    : supabase
        .from('onboarding_content')
        .select('id, type, subtype, title, description, content_text, business_id, businesses(name, location)')
        .in('business_id', businessIds)
        .or(`title.ilike.${ilike},description.ilike.${ilike},content_text.ilike.${ilike}`)
        .limit(25)

  const policyPromise = supabase
    .from('policy_strips')
    .select('id, title, content, category')
    .eq('is_active', true)
    .or(`title.ilike.${ilike},content.ilike.${ilike}`)
    .limit(25)

  const [onbRes, polRes] = await Promise.all([onboardingPromise, policyPromise])

  if (onbRes.error || polRes.error) {
    console.error('[knowledge search]', { onb: onbRes.error, pol: polRes.error })
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }

  const stripHtml = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  const buildPreview = (text: string, query: string) => {
    const clean = stripHtml(text || '')
    if (!clean) return ''
    const lower = clean.toLowerCase()
    const idx = lower.indexOf(query.toLowerCase())
    if (idx === -1) return clean.slice(0, 200)
    const start = Math.max(0, idx - 60)
    const end = Math.min(clean.length, idx + query.length + 140)
    return (start > 0 ? '… ' : '') + clean.slice(start, end) + (end < clean.length ? ' …' : '')
  }

  const results: Array<{
    id: string
    kind: 'onboarding' | 'policy'
    type: string
    title: string
    preview: string
    href: string
    badge: string | null
  }> = []

  for (const h of (onbRes.data as OnboardingHit[]) || []) {
    const biz = h.businesses
    const bizLabel = biz ? (biz.location ? `${biz.name} — ${biz.location}` : biz.name) : null
    const previewSource = h.description || h.content_text || h.title
    results.push({
      id: h.id,
      kind: 'onboarding',
      type: h.type,
      title: h.title,
      preview: buildPreview(previewSource, sanitized),
      href: `/employee/onboarding/${h.business_id}/${h.id}`,
      badge: bizLabel,
    })
  }

  for (const p of (polRes.data as PolicyHit[]) || []) {
    results.push({
      id: p.id,
      kind: 'policy',
      type: 'policy',
      title: p.title,
      preview: buildPreview(p.content, sanitized),
      href: `/employee/knowledge/policy/${p.id}`,
      badge: p.category || 'Policy',
    })
  }

  // Rank: title match first, then description/content match
  const lowerQ = sanitized.toLowerCase()
  results.sort((a, b) => {
    const aTitle = a.title.toLowerCase().includes(lowerQ) ? 0 : 1
    const bTitle = b.title.toLowerCase().includes(lowerQ) ? 0 : 1
    if (aTitle !== bTitle) return aTitle - bTitle
    return a.title.localeCompare(b.title)
  })

  return NextResponse.json({ results: results.slice(0, 30) })
}
