import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const VALID_TYPES = ['person', 'role', 'brand', 'location'] as const
type NodeType = (typeof VALID_TYPES)[number]

async function requireAdmin() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
    const { data: profile } = await supabase
        .from('profiles')
        .select('role, admin_scoped')
        .eq('id', user.id)
        .single()
    const p = profile as { role?: string; admin_scoped?: boolean } | null
    if (p?.role !== 'admin') {
        return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
    }
    // Org chart is read-only for scoped admins; editing requires full admin.
    if (p?.admin_scoped) {
        return { error: NextResponse.json({ error: 'Forbidden - org chart is read-only for your role' }, { status: 403 }) }
    }
    return { supabase }
}

// POST /api/admin/org-chart/nodes
// Body: { parent_id, node_type, name, subtitle?, business_id?, photo_url?, sort_order? }
export async function POST(request: NextRequest) {
    try {
        const auth = await requireAdmin()
        if ('error' in auth) return auth.error

        const body = await request.json()
        const { parent_id, node_type, name, subtitle, business_id, photo_url, sort_order } = body

        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            return NextResponse.json({ error: 'Name is required' }, { status: 400 })
        }
        if (name.length > 200) {
            return NextResponse.json({ error: 'Name too long' }, { status: 400 })
        }
        if (!VALID_TYPES.includes(node_type)) {
            return NextResponse.json({ error: 'Invalid node_type' }, { status: 400 })
        }

        const insertRow: Record<string, unknown> = {
            parent_id: parent_id ?? null,
            node_type: node_type as NodeType,
            name: name.trim(),
            subtitle: subtitle ? String(subtitle).trim().slice(0, 200) : null,
            business_id: typeof business_id === 'number' ? business_id : null,
            photo_url: typeof photo_url === 'string' && photo_url.length <= 1000 ? photo_url : null,
            sort_order: typeof sort_order === 'number' ? sort_order : 0,
        }

        const { data, error } = await auth.supabase
            .from('org_nodes')
            .insert(insertRow as never)
            .select()
            .single()

        if (error) {
            console.error('Insert org_node failed:', error)
            return NextResponse.json({ error: 'Failed to create node' }, { status: 500 })
        }
        return NextResponse.json({ node: data })
    } catch (err) {
        console.error('POST /api/admin/org-chart/nodes error:', err)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}

// PATCH /api/admin/org-chart/nodes  (batch reorder/move)
// Body: { updates: [{ id, parent_id?, sort_order?, name?, subtitle?, node_type?, business_id?, photo_url? }] }
export async function PATCH(request: NextRequest) {
    try {
        const auth = await requireAdmin()
        if ('error' in auth) return auth.error

        const body = await request.json()
        const updates: Array<Record<string, unknown>> = Array.isArray(body?.updates) ? body.updates : []
        if (updates.length === 0) {
            return NextResponse.json({ error: 'No updates provided' }, { status: 400 })
        }
        if (updates.length > 200) {
            return NextResponse.json({ error: 'Too many updates' }, { status: 400 })
        }

        const allowedKeys = new Set([
            'parent_id', 'sort_order', 'name', 'subtitle', 'node_type', 'business_id', 'photo_url',
        ])

        // Apply each update sequentially (cycle prevention check below)
        // First, fetch all nodes once to validate parent moves don't create cycles
        const { data: allNodes, error: fetchErr } = await auth.supabase
            .from('org_nodes')
            .select('id, parent_id')
        if (fetchErr) {
            return NextResponse.json({ error: 'Failed to load tree' }, { status: 500 })
        }

        // Build current parent map
        const parentMap = new Map<string, string | null>()
        for (const n of (allNodes || []) as Array<{ id: string; parent_id: string | null }>) {
            parentMap.set(n.id, n.parent_id)
        }

        // Apply proposed parent changes to a copy and detect cycles
        const proposed = new Map(parentMap)
        for (const u of updates) {
            const id = u.id as string | undefined
            if (!id || !parentMap.has(id)) {
                return NextResponse.json({ error: 'Invalid node id in updates' }, { status: 400 })
            }
            if ('parent_id' in u) {
                proposed.set(id, (u.parent_id as string | null) ?? null)
            }
            if (u.node_type !== undefined && !VALID_TYPES.includes(u.node_type as NodeType)) {
                return NextResponse.json({ error: 'Invalid node_type' }, { status: 400 })
            }
            if (u.name !== undefined) {
                if (typeof u.name !== 'string' || u.name.trim().length === 0 || u.name.length > 200) {
                    return NextResponse.json({ error: 'Invalid name' }, { status: 400 })
                }
            }
        }

        // Cycle detection: walk up from each node, fail if we revisit
        const ids = Array.from(proposed.keys())
        for (const id of ids) {
            const seen = new Set<string>()
            let cur: string | null = id
            while (cur) {
                if (seen.has(cur)) {
                    return NextResponse.json({ error: 'Move would create a cycle' }, { status: 400 })
                }
                seen.add(cur)
                cur = proposed.get(cur) ?? null
            }
        }

        // Apply updates
        for (const u of updates) {
            const id = u.id as string
            const patch: Record<string, unknown> = {}
            for (const k of Object.keys(u)) {
                if (allowedKeys.has(k)) {
                    let v = u[k] as unknown
                    if (k === 'name' && typeof v === 'string') v = (v as string).trim()
                    if (k === 'subtitle' && typeof v === 'string') v = (v as string).trim().slice(0, 200)
                    patch[k] = v
                }
            }
            if (Object.keys(patch).length === 0) continue
            const { error } = await auth.supabase
                .from('org_nodes')
                .update(patch as never)
                .eq('id', id)
            if (error) {
                console.error('Update org_node failed:', error)
                return NextResponse.json({ error: 'Failed to update node' }, { status: 500 })
            }
        }

        return NextResponse.json({ success: true })
    } catch (err) {
        console.error('PATCH /api/admin/org-chart/nodes error:', err)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
