import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/admin/org-chart
// Returns:
//   nodes: OrgNode[]
//   businesses: Business[]
//   employees: { id, display_name, position, profile_picture_url, is_active,
//                created_at, email, full_name, business_ids[] }[]
export async function GET() {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single()
        if ((profile as { role?: string } | null)?.role !== 'admin') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        const [nodesRes, businessesRes, employeesRes, junctionRes] = await Promise.all([
            supabase.from('org_nodes').select('*').order('sort_order'),
            supabase.from('businesses').select('*').order('name'),
            supabase
                .from('employees')
                .select(`
                    id,
                    display_name,
                    position,
                    profile_picture_url,
                    is_active,
                    created_at,
                    work_location,
                    profiles ( email, full_name )
                `)
                .order('display_name'),
            supabase.from('employee_businesses').select('*'),
        ])

        if (nodesRes.error) throw nodesRes.error
        if (businessesRes.error) throw businessesRes.error
        if (employeesRes.error) throw employeesRes.error
        if (junctionRes.error) throw junctionRes.error

        // Build employees → business_ids map
        const byEmp = new Map<string, number[]>()
        const junctionRows = (junctionRes.data || []) as Array<{ employee_id: string; business_id: number }>
        for (const row of junctionRows) {
            const arr = byEmp.get(row.employee_id) || []
            arr.push(row.business_id)
            byEmp.set(row.employee_id, arr)
        }

        const employees = (employeesRes.data || []).map((e: Record<string, unknown>) => {
            const prof = (e.profiles as { email?: string | null; full_name?: string | null } | null) || null
            return {
                id: e.id as string,
                display_name: e.display_name as string | null,
                position: e.position as string | null,
                profile_picture_url: e.profile_picture_url as string | null,
                is_active: e.is_active as boolean,
                created_at: e.created_at as string,
                work_location: e.work_location as string | null,
                email: prof?.email ?? null,
                full_name: prof?.full_name ?? null,
                business_ids: byEmp.get(e.id as string) || [],
            }
        })

        return NextResponse.json({
            nodes: nodesRes.data || [],
            businesses: businessesRes.data || [],
            employees,
        })
    } catch (err) {
        console.error('GET /api/admin/org-chart error:', err)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
