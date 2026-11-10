import { NextResponse } from 'next/server'
import {
  createClient as createServerSupabase,
  createServiceClient,
} from '@/lib/supabase/server'

/**
 * Central admin authorization + location-scoping helper.
 *
 * Two admin tiers exist on top of `profiles.role === 'admin'`:
 *  - super admins (`is_super_admin`) — manage roles/scopes; full company access.
 *  - scoped admins (`admin_scoped`) — restricted to their assigned locations
 *    (see `admin_businesses`). They may only see/manage employees whose
 *    `employee_businesses` intersect their managed businesses.
 *
 * DB-level RLS is the real gate for direct client queries. These helpers exist
 * for the API routes that use the SERVICE ROLE client (which bypasses RLS) and
 * therefore must enforce scope explicitly.
 */

export interface AdminContext {
  userId: string
  role: 'admin' | 'employee'
  isSuperAdmin: boolean
  isScoped: boolean
  managedBusinessIds: number[]
}

export type AdminGate =
  | { ok: true; ctx: AdminContext }
  | { ok: false; response: NextResponse }

/** Resolve the current session user's admin context (null if not signed in). */
export async function getAdminContext(): Promise<AdminContext | null> {
  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const service = await createServiceClient()
  const { data: profileRaw } = await service
    .from('profiles')
    .select('role, is_super_admin, admin_scoped')
    .eq('id', user.id)
    .single()
  const profile = profileRaw as
    | { role: 'admin' | 'employee'; is_super_admin: boolean | null; admin_scoped: boolean | null }
    | null
  if (!profile) return null

  const isScoped = profile.role === 'admin' && profile.admin_scoped === true

  let managedBusinessIds: number[] = []
  if (isScoped) {
    const { data: rows } = await service
      .from('admin_businesses')
      .select('business_id')
      .eq('admin_id', user.id)
    managedBusinessIds = ((rows || []) as { business_id: number }[]).map((r) => r.business_id)
  }

  return {
    userId: user.id,
    role: profile.role,
    isSuperAdmin: !!profile.is_super_admin,
    isScoped,
    managedBusinessIds,
  }
}

const unauthorized = () =>
  NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
const forbidden = () =>
  NextResponse.json({ error: 'Forbidden' }, { status: 403 })

/** Require any admin (full, super, or scoped). */
export async function requireAdmin(): Promise<AdminGate> {
  const ctx = await getAdminContext()
  if (!ctx) return { ok: false, response: unauthorized() }
  if (ctx.role !== 'admin') return { ok: false, response: forbidden() }
  return { ok: true, ctx }
}

/** Require a super admin (role/permission management). */
export async function requireSuperAdmin(): Promise<AdminGate> {
  const gate = await requireAdmin()
  if (!gate.ok) return gate
  if (!gate.ctx.isSuperAdmin) return { ok: false, response: forbidden() }
  return gate
}

/** Require a NON-scoped admin (company-wide functions off-limits to scoped admins). */
export async function requireFullAdmin(): Promise<AdminGate> {
  const gate = await requireAdmin()
  if (!gate.ok) return gate
  if (gate.ctx.isScoped) return { ok: false, response: forbidden() }
  return gate
}

/**
 * The exact set of employee ids a context may act on.
 * Returns `null` when unrestricted (full/super admin) — callers should treat
 * null as "no filter". Scoped admins with no managed businesses get `[]`.
 */
export async function getScopedEmployeeIds(
  ctx: AdminContext,
): Promise<string[] | null> {
  if (!ctx.isScoped) return null
  if (ctx.managedBusinessIds.length === 0) return []
  const service = await createServiceClient()
  const { data } = await service
    .from('employee_businesses')
    .select('employee_id')
    .in('business_id', ctx.managedBusinessIds)
  return Array.from(new Set(((data || []) as { employee_id: string }[]).map((r) => r.employee_id)))
}

/** Whether a single employee is within the context's scope. */
export async function isEmployeeInScope(
  ctx: AdminContext,
  employeeId: string,
): Promise<boolean> {
  if (!ctx.isScoped) return true
  if (ctx.managedBusinessIds.length === 0) return false
  const service = await createServiceClient()
  const { data } = await service
    .from('employee_businesses')
    .select('business_id')
    .eq('employee_id', employeeId)
    .in('business_id', ctx.managedBusinessIds)
    .limit(1)
  return !!(data && data.length > 0)
}
