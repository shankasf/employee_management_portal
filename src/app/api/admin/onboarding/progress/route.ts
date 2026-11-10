import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { logActivity, getRequestInfo } from '@/lib/activity-log'
import { getAdminContext } from '@/lib/auth/adminScope'

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

interface BusinessRow { id: number; name: string; location: string | null }
interface ContentRow { id: string; business_id: number; is_required: boolean }
interface ProgressRow { employee_id: string; content_id: string; max_watched_pct: number; completed_at: string | null }
interface CompletionRow { employee_id: string; business_id: number; completed_at: string; acknowledged_by_admin: boolean }
interface EmpBusiness { employee_id: string; business_id: number }
interface EmpRow { id: string; display_name: string | null; profiles: { full_name: string | null; email: string | null } | null }

// GET — aggregate progress per (employee, business)
export async function GET() {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  // Scoped admins only monitor onboarding for their managed locations.
  const ctx = await getAdminContext()
  const managedSet = ctx?.isScoped ? new Set(ctx.managedBusinessIds) : null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createServiceClient()) as any

  const [
    { data: empAssignments, error: ebErr },
    { data: employees, error: empErr },
    { data: businesses, error: bizErr },
    { data: content, error: cErr },
    { data: progress, error: pErr },
    { data: completions, error: compErr },
  ] = await Promise.all([
    supabase.from('employee_businesses').select('employee_id, business_id'),
    supabase.from('employees').select('id, display_name, profiles!inner(full_name, email)'),
    supabase.from('businesses').select('id, name, location'),
    supabase.from('onboarding_content').select('id, business_id, is_required'),
    supabase.from('onboarding_progress').select('employee_id, content_id, max_watched_pct, completed_at'),
    supabase.from('onboarding_completions').select('employee_id, business_id, completed_at, acknowledged_by_admin'),
  ])

  const errs = [ebErr, empErr, bizErr, cErr, pErr, compErr].filter(Boolean)
  if (errs.length) {
    console.error('[admin onboarding progress]', errs)
    return NextResponse.json({ error: 'Failed to load progress' }, { status: 500 })
  }

  // Index for fast lookup
  const businessById = new Map<number, BusinessRow>()
  for (const b of (businesses as BusinessRow[]) || []) businessById.set(b.id, b)

  const requiredCountByBusiness = new Map<number, number>()
  const totalCountByBusiness = new Map<number, number>()
  for (const c of (content as ContentRow[]) || []) {
    totalCountByBusiness.set(c.business_id, (totalCountByBusiness.get(c.business_id) || 0) + 1)
    if (c.is_required) requiredCountByBusiness.set(c.business_id, (requiredCountByBusiness.get(c.business_id) || 0) + 1)
  }

  const contentById = new Map<string, ContentRow>()
  for (const c of (content as ContentRow[]) || []) contentById.set(c.id, c)

  const completedByEmpBiz = new Map<string, { required: number; total: number }>()
  for (const p of (progress as ProgressRow[]) || []) {
    if (!p.completed_at) continue
    const c = contentById.get(p.content_id)
    if (!c) continue
    const key = `${p.employee_id}:${c.business_id}`
    const cur = completedByEmpBiz.get(key) || { required: 0, total: 0 }
    cur.total += 1
    if (c.is_required) cur.required += 1
    completedByEmpBiz.set(key, cur)
  }

  const completionByEmpBiz = new Map<string, CompletionRow>()
  for (const c of (completions as CompletionRow[]) || []) {
    completionByEmpBiz.set(`${c.employee_id}:${c.business_id}`, c)
  }

  const empById = new Map<string, EmpRow>()
  for (const e of (employees as EmpRow[]) || []) empById.set(e.id, e)

  const rows: Array<{
    employee_id: string
    employee_name: string
    employee_email: string | null
    business_id: number
    business_name: string
    business_location: string | null
    required_total: number
    items_total: number
    required_completed: number
    items_completed: number
    progress_pct: number
    is_completed: boolean
    completed_at: string | null
    acknowledged: boolean
  }> = []

  for (const eb of (empAssignments as EmpBusiness[]) || []) {
    // Scope filter: only rows for the admin's managed locations.
    if (managedSet && !managedSet.has(eb.business_id)) continue
    const emp = empById.get(eb.employee_id)
    if (!emp) continue
    const biz = businessById.get(eb.business_id)
    if (!biz) continue

    const requiredTotal = requiredCountByBusiness.get(eb.business_id) || 0
    const itemsTotal = totalCountByBusiness.get(eb.business_id) || 0
    const counts = completedByEmpBiz.get(`${eb.employee_id}:${eb.business_id}`) || { required: 0, total: 0 }
    const completion = completionByEmpBiz.get(`${eb.employee_id}:${eb.business_id}`)
    const progressPct = requiredTotal === 0 ? 100 : Math.round((counts.required / requiredTotal) * 100)

    rows.push({
      employee_id: eb.employee_id,
      employee_name: emp.display_name || emp.profiles?.full_name || 'Employee',
      employee_email: emp.profiles?.email || null,
      business_id: eb.business_id,
      business_name: biz.name,
      business_location: biz.location,
      required_total: requiredTotal,
      items_total: itemsTotal,
      required_completed: counts.required,
      items_completed: counts.total,
      progress_pct: progressPct,
      is_completed: !!completion,
      completed_at: completion?.completed_at || null,
      acknowledged: completion?.acknowledged_by_admin ?? true,
    })
  }

  // Sort: incomplete first, then by progress desc, then by name
  rows.sort((a, b) => {
    if (a.is_completed !== b.is_completed) return a.is_completed ? 1 : -1
    if (a.progress_pct !== b.progress_pct) return b.progress_pct - a.progress_pct
    return a.employee_name.localeCompare(b.employee_name)
  })

  return NextResponse.json({ rows })
}

// POST — admin acknowledges a completion (clears badge)
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

  const employeeId = body.employee_id ? String(body.employee_id) : null
  const businessId = body.business_id != null ? Number(body.business_id) : null

  // Scoped admins may only acknowledge completions within their locations.
  const ctx = await getAdminContext()
  if (ctx?.isScoped && (businessId == null || !ctx.managedBusinessIds.includes(businessId))) {
    return NextResponse.json({ error: 'Forbidden - outside your assigned locations' }, { status: 403 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createServiceClient()) as any

  if (employeeId && businessId) {
    // Single acknowledgement — capture employee + business labels for the log
    const [{ data: emp }, { data: biz }, { error }] = await Promise.all([
      supabase
        .from('employees')
        .select('display_name, profiles!inner(full_name, email)')
        .eq('id', employeeId)
        .maybeSingle(),
      supabase.from('businesses').select('name, location').eq('id', businessId).maybeSingle(),
      supabase
        .from('onboarding_completions')
        .update({ acknowledged_by_admin: true })
        .eq('employee_id', employeeId)
        .eq('business_id', businessId),
    ])
    if (error) {
      console.error('[admin onboarding ack]', error)
      return NextResponse.json({ error: 'Failed to acknowledge' }, { status: 500 })
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const empAny = emp as any
    const employeeName = empAny?.display_name || empAny?.profiles?.full_name || 'Employee'
    const employeeEmail = empAny?.profiles?.email || null
    const bizLabel = biz ? (biz.location ? `${biz.name} — ${biz.location}` : biz.name) : `Business #${businessId}`

    logActivity({
      adminId: auth.user.id,
      adminEmail: auth.adminEmail,
      action: 'onboarding_completion_acknowledged',
      entityType: 'onboarding_completion',
      entityId: `${employeeId}:${businessId}`,
      entityName: `${employeeName} — ${bizLabel}`,
      details: {
        employee_id: employeeId,
        employee_email: employeeEmail,
        business_id: businessId,
        business_label: bizLabel,
      },
      ipAddress,
      userAgent,
    })
  } else {
    // Bulk acknowledge — count what we're about to update for the log
    const { count } = await supabase
      .from('onboarding_completions')
      .select('id', { count: 'exact', head: true })
      .eq('acknowledged_by_admin', false)

    const { error } = await supabase
      .from('onboarding_completions')
      .update({ acknowledged_by_admin: true })
      .eq('acknowledged_by_admin', false)

    if (error) {
      console.error('[admin onboarding ack bulk]', error)
      return NextResponse.json({ error: 'Failed to acknowledge' }, { status: 500 })
    }

    logActivity({
      adminId: auth.user.id,
      adminEmail: auth.adminEmail,
      action: 'onboarding_completions_bulk_acknowledged',
      entityType: 'onboarding_completion',
      details: { count: count || 0 },
      ipAddress,
      userAgent,
    })
  }

  return NextResponse.json({ success: true })
}
