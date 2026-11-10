import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

interface EmployeeRow {
  id: string
  display_name: string | null
  position: string | null
  profiles: { email: string | null; full_name: string | null } | null
}

interface ReadRow {
  employee_id: string
  read_at: string
}

// GET /api/admin/policies/[id]/reads
// Returns the list of employees with their read status for this important
// message, plus aggregate counts. Admin-only.
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createServiceClient()) as any

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const [{ data: employees, error: eErr }, { data: reads, error: rErr }] = await Promise.all([
    supabase
      .from('employees')
      .select('id, display_name, position, profiles(email, full_name)')
      .order('display_name', { ascending: true }),
    supabase
      .from('policy_strip_reads')
      .select('employee_id, read_at')
      .eq('policy_strip_id', id),
  ])

  if (eErr || rErr) {
    console.error('[admin/policies/reads]', { eErr, rErr })
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 })
  }

  const readByEmployee = new Map<string, string>()
  for (const r of (reads as ReadRow[]) || []) {
    readByEmployee.set(r.employee_id, r.read_at)
  }

  const items = ((employees as EmployeeRow[]) || []).map(e => ({
    employee_id: e.id,
    name: e.display_name || e.profiles?.full_name || 'Unknown',
    email: e.profiles?.email || null,
    position: e.position,
    read_at: readByEmployee.get(e.id) || null,
  }))

  const readCount = items.filter(i => i.read_at).length

  return NextResponse.json({
    total: items.length,
    read_count: readCount,
    unread_count: items.length - readCount,
    items,
  })
}
