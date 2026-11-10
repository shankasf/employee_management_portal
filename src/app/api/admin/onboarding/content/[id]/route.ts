import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { logActivity, getRequestInfo } from '@/lib/activity-log'

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

// PATCH — update fields
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error
  const { ipAddress, userAgent } = getRequestInfo(request.headers)
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}
  const fields = [
    'business_id', 'type', 'title', 'description', 'content_url', 'content_text',
    'subtype', 'is_required', 'sort_order', 'duration_seconds', 'file_size',
  ]
  for (const f of fields) {
    if (f in body) updates[f] = body[f]
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }
  if ('content_url' in updates && updates.content_url && !/^https?:\/\//i.test(String(updates.content_url))) {
    return NextResponse.json({ error: 'content_url must be http(s)' }, { status: 400 })
  }
  if ('business_id' in updates) {
    const bid = Number(updates.business_id)
    if (!Number.isInteger(bid) || bid <= 0) {
      return NextResponse.json({ error: 'business_id must be a positive integer' }, { status: 400 })
    }
    updates.business_id = bid
  }
  if ('type' in updates) {
    const t = String(updates.type)
    if (!['video', 'document', 'article'].includes(t)) {
      return NextResponse.json({ error: 'invalid type' }, { status: 400 })
    }
    updates.type = t
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createServiceClient()) as any

  // Snapshot the existing row so we can diff and clean up the old file if needed
  const { data: existing } = await supabase
    .from('onboarding_content')
    .select('*')
    .eq('id', id)
    .single()

  if (!existing) {
    return NextResponse.json({ error: 'Content not found' }, { status: 404 })
  }

  let oldUrlToDelete: string | null = null
  if ('content_url' in updates) {
    const oldUrl = existing.content_url ? String(existing.content_url) : null
    const newUrl = updates.content_url ? String(updates.content_url) : null
    if (oldUrl && oldUrl !== newUrl) oldUrlToDelete = oldUrl
  }

  const { data, error } = await supabase
    .from('onboarding_content')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    console.error('[admin onboarding content PATCH]', error)
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
  }

  // Best-effort cleanup of the orphaned old file.
  // Skip when any other row still references the same URL — "All Locations"
  // creates duplicate rows that share a single storage object.
  if (oldUrlToDelete) {
    const { count: refs } = await supabase
      .from('onboarding_content')
      .select('id', { count: 'exact', head: true })
      .eq('content_url', oldUrlToDelete)
      .neq('id', id)
    if (!refs || refs === 0) {
      const cleanUrl = oldUrlToDelete.split('?')[0]
      const marker = '/onboarding-content/'
      const idx = cleanUrl.indexOf(marker)
      if (idx !== -1) {
        const path = cleanUrl.slice(idx + marker.length)
        try {
          await supabase.storage.from('onboarding-content').remove([path])
        } catch (e) {
          console.error('[admin onboarding content PATCH storage cleanup]', e)
        }
      }
    }
  }

  // Diff: capture only fields that actually changed
  const changes: Record<string, { from: unknown; to: unknown }> = {}
  for (const k of Object.keys(updates)) {
    if (existing[k] !== updates[k]) {
      // Truncate long text fields so the activity log stays compact
      const truncate = (v: unknown) =>
        typeof v === 'string' && v.length > 200 ? v.slice(0, 200) + '…' : v
      changes[k] = { from: truncate(existing[k]), to: truncate(updates[k]) }
    }
  }

  // Resolve business labels for friendlier display when business changed
  let businessFromLabel: string | null = null
  let businessToLabel: string | null = null
  if (changes.business_id) {
    const { data: bizRows } = await supabase
      .from('businesses')
      .select('id, name, location')
      .in('id', [existing.business_id, updates.business_id])
    type Biz = { id: number; name: string; location: string | null }
    const byId = new Map<number, Biz>(((bizRows as Biz[]) || []).map(b => [b.id, b]))
    const fromBiz = byId.get(existing.business_id)
    const toBiz = byId.get(Number(updates.business_id))
    if (fromBiz) businessFromLabel = fromBiz.location ? `${fromBiz.name} — ${fromBiz.location}` : fromBiz.name
    if (toBiz) businessToLabel = toBiz.location ? `${toBiz.name} — ${toBiz.location}` : toBiz.name
  }

  if (Object.keys(changes).length > 0) {
    logActivity({
      adminId: auth.user.id,
      adminEmail: auth.adminEmail,
      action: 'onboarding_content_updated',
      entityType: 'onboarding_content',
      entityId: id,
      entityName: data.title,
      details: {
        changes,
        ...(businessFromLabel ? { business_from: businessFromLabel } : {}),
        ...(businessToLabel ? { business_to: businessToLabel } : {}),
      },
      ipAddress,
      userAgent,
    })
  }

  return NextResponse.json({ content: data })
}

// DELETE — delete content row + storage object
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error
  const { ipAddress, userAgent } = getRequestInfo(request.headers)
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createServiceClient()) as any

  // Pull full snapshot for the activity log
  const { data: existing, error: fetchErr } = await supabase
    .from('onboarding_content')
    .select('id, business_id, type, subtype, title, is_required, content_url, businesses(name, location)')
    .eq('id', id)
    .single()

  if (fetchErr) {
    return NextResponse.json({ error: 'Content not found' }, { status: 404 })
  }

  // Best-effort storage cleanup.
  // Skip when any other row still references the same URL — "All Locations"
  // creates duplicate rows that share a single storage object.
  if (existing?.content_url) {
    const { count: refs } = await supabase
      .from('onboarding_content')
      .select('id', { count: 'exact', head: true })
      .eq('content_url', existing.content_url)
      .neq('id', id)
    if (!refs || refs === 0) {
      const url = String(existing.content_url).split('?')[0]
      const marker = '/onboarding-content/'
      const idx = url.indexOf(marker)
      if (idx !== -1) {
        const path = url.slice(idx + marker.length)
        try {
          await supabase.storage.from('onboarding-content').remove([path])
        } catch (e) {
          console.error('[admin onboarding content DELETE storage]', e)
        }
      }
    }
  }

  const { error } = await supabase
    .from('onboarding_content')
    .delete()
    .eq('id', id)

  if (error) {
    console.error('[admin onboarding content DELETE]', error)
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
  }

  const biz = existing.businesses
  const bizLabel = biz ? (biz.location ? `${biz.name} — ${biz.location}` : biz.name) : `Business #${existing.business_id}`

  logActivity({
    adminId: auth.user.id,
    adminEmail: auth.adminEmail,
    action: 'onboarding_content_deleted',
    entityType: 'onboarding_content',
    entityId: id,
    entityName: existing.title,
    details: {
      business_id: existing.business_id,
      business_label: bizLabel,
      type: existing.type,
      subtype: existing.subtype,
      is_required: existing.is_required,
    },
    ipAddress,
    userAgent,
  })

  return NextResponse.json({ success: true })
}
