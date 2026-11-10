import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { logActivity, getRequestInfo } from '@/lib/activity-log'

const ALLOWED_TYPES = ['video', 'document', 'article'] as const
const ALLOWED_SUBTYPES = ['pdf', 'image', 'docx', 'audio', 'video'] as const

type ContentType = (typeof ALLOWED_TYPES)[number]
type ContentSubtype = (typeof ALLOWED_SUBTYPES)[number]

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, email')
    .eq('id', user.id)
    .single()

  if ((profile as { role: string; email: string } | null)?.role !== 'admin') {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return {
    user,
    adminEmail: (profile as { role: string; email: string } | null)?.email || user.email || 'unknown',
  }
}

// GET — list all onboarding content (optionally filter by business_id)
export async function GET(request: Request) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const url = new URL(request.url)
  const businessId = url.searchParams.get('business_id')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createServiceClient()) as any
  let query = supabase
    .from('onboarding_content')
    .select('*, businesses(id, name, location)')
    .order('business_id', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (businessId) query = query.eq('business_id', Number(businessId))

  const { data, error } = await query
  if (error) {
    console.error('[admin onboarding content GET]', error)
    return NextResponse.json({ error: 'Failed to load content' }, { status: 500 })
  }
  return NextResponse.json({ content: data })
}

// POST — create content row (file should be pre-uploaded to storage, URL passed in)
export async function POST(request: Request) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error
  const { ipAddress, userAgent } = getRequestInfo(request.headers)

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Accept either business_ids[] (multi-location) or business_id (single).
  const rawIds = Array.isArray(body.business_ids)
    ? body.business_ids
    : body.business_id != null ? [body.business_id] : []
  const businessIds = Array.from(new Set(
    rawIds
      .map((v) => Number(v))
      .filter((n) => Number.isInteger(n) && n > 0)
  ))

  const type = String(body.type || '') as ContentType
  const title = String(body.title || '').trim()
  const description = body.description ? String(body.description) : null
  const subtype = body.subtype ? (String(body.subtype) as ContentSubtype) : null
  const contentUrl = body.content_url ? String(body.content_url) : null
  const contentText = body.content_text ? String(body.content_text) : null
  const fileSize = body.file_size != null ? Number(body.file_size) : null
  const durationSeconds = body.duration_seconds != null ? Number(body.duration_seconds) : null
  const isRequired = body.is_required !== false
  const sortOrder = body.sort_order != null ? Number(body.sort_order) : 0

  if (businessIds.length === 0 || !ALLOWED_TYPES.includes(type) || !title) {
    return NextResponse.json({ error: 'business_id(s), type, and title required' }, { status: 400 })
  }
  if (subtype && !ALLOWED_SUBTYPES.includes(subtype)) {
    return NextResponse.json({ error: 'Invalid subtype' }, { status: 400 })
  }
  if (type !== 'article' && !contentUrl) {
    return NextResponse.json({ error: 'content_url required for video/document' }, { status: 400 })
  }
  if (type === 'article' && !contentText) {
    return NextResponse.json({ error: 'content_text required for article' }, { status: 400 })
  }
  if (contentUrl && !/^https?:\/\//i.test(contentUrl)) {
    return NextResponse.json({ error: 'content_url must be http(s)' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createServiceClient()) as any

  // Reject any IDs that don't exist in the businesses table. Doing this up
  // front prevents partial inserts on bad input.
  const { data: existingBiz } = await supabase
    .from('businesses')
    .select('id, name, location')
    .in('id', businessIds)
  type BizRow = { id: number; name: string; location: string | null }
  const bizById = new Map<number, BizRow>(((existingBiz as BizRow[]) || []).map(b => [b.id, b]))
  const missing = businessIds.filter(id => !bizById.has(id))
  if (missing.length > 0) {
    return NextResponse.json({ error: `Unknown business id(s): ${missing.join(', ')}` }, { status: 400 })
  }

  const rows = businessIds.map(bid => ({
    business_id: bid,
    type,
    subtype,
    title,
    description,
    content_url: contentUrl,
    content_text: contentText,
    file_size: fileSize,
    duration_seconds: durationSeconds,
    is_required: isRequired,
    sort_order: sortOrder,
    created_by: auth.user.id,
  }))

  const { data, error } = await supabase
    .from('onboarding_content')
    .insert(rows)
    .select('*')

  if (error) {
    console.error('[admin onboarding content POST]', error)
    return NextResponse.json({ error: 'Failed to create content' }, { status: 500 })
  }

  const labelFor = (id: number) => {
    const b = bizById.get(id)
    return b ? (b.location ? `${b.name} — ${b.location}` : b.name) : `Business #${id}`
  }

  // Single activity log entry per created row keeps audit trail granular.
  for (const row of (data as { id: string; business_id: number }[])) {
    logActivity({
      adminId: auth.user.id,
      adminEmail: auth.adminEmail,
      action: 'onboarding_content_created',
      entityType: 'onboarding_content',
      entityId: row.id,
      entityName: title,
      details: {
        business_id: row.business_id,
        business_label: labelFor(row.business_id),
        type,
        subtype,
        is_required: isRequired,
        sort_order: sortOrder,
        file_size: fileSize,
        duration_seconds: durationSeconds,
        ...(businessIds.length > 1 ? { bulk_count: businessIds.length } : {}),
      },
      ipAddress,
      userAgent,
    })
  }

  return NextResponse.json({
    content: data,
    created_count: Array.isArray(data) ? data.length : 1,
  })
}
