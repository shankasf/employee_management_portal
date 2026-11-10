import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

// GET /api/employee/org-chart
// Read-only org chart for any authenticated user (employees + admins). Returns
// the same node/business shape as the admin endpoint but with only basic,
// non-sensitive employee info: name, birthday, manager (derived from the tree),
// and store name + address. No hours, schedules, or HR data.
export async function GET() {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        // Employees can't read other employees' rows under RLS, so use the
        // service client for the directory after confirming the requester is
        // authenticated.
        const service = await createServiceClient()

        const [nodesRes, businessesRes, employeesRes, junctionRes] = await Promise.all([
            service.from('org_nodes').select('*').order('sort_order'),
            service.from('businesses').select('*').order('name'),
            service
                .from('employees')
                .select(`
                    id,
                    display_name,
                    position,
                    profile_picture_url,
                    is_active,
                    created_at,
                    work_location,
                    date_of_birth,
                    profiles ( email, full_name )
                `)
                .order('display_name'),
            service.from('employee_businesses').select('*'),
        ])

        if (nodesRes.error) throw nodesRes.error
        if (businessesRes.error) throw businessesRes.error
        if (employeesRes.error) throw employeesRes.error
        if (junctionRes.error) throw junctionRes.error

        const nodes = (nodesRes.data || []) as Array<{
            id: string
            parent_id: string | null
            node_type: string
            name: string
            business_id: number | null
        }>
        const businesses = (businessesRes.data || []) as Array<{ id: number; name: string; location: string | null }>

        // Manager of an employee = nearest ancestor person/role node above the
        // location node their store maps to. Precompute per business_id.
        const nodeById = new Map(nodes.map(n => [n.id, n]))
        const nearestManager = (nodeId: string): string | null => {
            const start = nodeById.get(nodeId)
            // Walk up parents; the location node itself is not a manager.
            let parentId = start?.parent_id ?? null
            const seen = new Set<string>()
            while (parentId && !seen.has(parentId)) {
                seen.add(parentId)
                const parent = nodeById.get(parentId)
                if (!parent) break
                if (parent.node_type === 'person' || parent.node_type === 'role') {
                    return parent.name
                }
                parentId = parent.parent_id
            }
            return null
        }

        const businessInfo = new Map<number, { managerName: string | null; storeName: string; storeAddress: string | null }>()
        for (const biz of businesses) {
            businessInfo.set(biz.id, {
                managerName: null,
                storeName: biz.name,
                storeAddress: biz.location,
            })
        }
        // Fill manager from the matching location node when present.
        for (const n of nodes) {
            if (n.node_type === 'location' && n.business_id != null) {
                const info = businessInfo.get(n.business_id)
                if (info && !info.managerName) {
                    info.managerName = nearestManager(n.id)
                }
            }
        }

        // employees → business_ids
        const byEmp = new Map<string, number[]>()
        const junctionRows = (junctionRes.data || []) as Array<{ employee_id: string; business_id: number }>
        for (const row of junctionRows) {
            const arr = byEmp.get(row.employee_id) || []
            arr.push(row.business_id)
            byEmp.set(row.employee_id, arr)
        }

        const employees = (employeesRes.data || []).map((e: Record<string, unknown>) => {
            const prof = (e.profiles as { email?: string | null; full_name?: string | null } | null) || null
            const businessIds = byEmp.get(e.id as string) || []
            const primary = businessIds.length ? businessInfo.get(businessIds[0]) : undefined
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
                business_ids: businessIds,
                date_of_birth: (e.date_of_birth as string | null) ?? null,
                manager_name: primary?.managerName ?? null,
                store_name: primary?.storeName ?? null,
                store_address: primary?.storeAddress ?? null,
            }
        })

        return NextResponse.json({
            nodes: nodesRes.data || [],
            businesses: businessesRes.data || [],
            employees,
        })
    } catch (err) {
        console.error('GET /api/employee/org-chart error:', err)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
