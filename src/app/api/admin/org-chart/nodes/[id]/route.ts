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

// PATCH /api/admin/org-chart/nodes/[id]  (single node)
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
    try {
        const auth = await requireAdmin()
        if ('error' in auth) return auth.error

        const { id } = params
        const body = await request.json()

        const patch: Record<string, unknown> = {}
        const allowed: Array<[string, (v: unknown) => unknown | undefined]> = [
            ['name', v => {
                if (typeof v !== 'string') return undefined
                const t = v.trim()
                if (!t || t.length > 200) return undefined
                return t
            }],
            ['subtitle', v => {
                if (v === null) return null
                if (typeof v !== 'string') return undefined
                return v.trim().slice(0, 200) || null
            }],
            ['node_type', v => VALID_TYPES.includes(v as NodeType) ? v : undefined],
            ['parent_id', v => (v === null || typeof v === 'string') ? v : undefined],
            ['business_id', v => (v === null || typeof v === 'number') ? v : undefined],
            ['photo_url', v => {
                if (v === null) return null
                if (typeof v !== 'string' || v.length > 1000) return undefined
                return v
            }],
            ['sort_order', v => typeof v === 'number' ? v : undefined],
        ]
        for (const [k, parse] of allowed) {
            if (k in body) {
                const parsed = parse(body[k])
                if (parsed === undefined) {
                    return NextResponse.json({ error: `Invalid value for ${k}` }, { status: 400 })
                }
                patch[k] = parsed
            }
        }

        if (Object.keys(patch).length === 0) {
            return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
        }

        // Cycle check if parent_id is changing
        if ('parent_id' in patch) {
            const newParent = patch.parent_id as string | null
            if (newParent === id) {
                return NextResponse.json({ error: 'Node cannot be its own parent' }, { status: 400 })
            }
            if (newParent) {
                const { data: all, error: fetchErr } = await auth.supabase
                    .from('org_nodes')
                    .select('id, parent_id')
                if (fetchErr) {
                    return NextResponse.json({ error: 'Failed to validate parent' }, { status: 500 })
                }
                const parentMap = new Map<string, string | null>()
                for (const n of (all || []) as Array<{ id: string; parent_id: string | null }>) {
                    parentMap.set(n.id, n.parent_id)
                }
                // Walk up from newParent — if we hit id, it would create a cycle
                let cur: string | null = newParent
                const seen = new Set<string>()
                while (cur) {
                    if (cur === id) {
                        return NextResponse.json({ error: 'Move would create a cycle' }, { status: 400 })
                    }
                    if (seen.has(cur)) break
                    seen.add(cur)
                    cur = parentMap.get(cur) ?? null
                }
            }
        }

        const { data, error } = await auth.supabase
            .from('org_nodes')
            .update(patch as never)
            .eq('id', id)
            .select()
            .single()
        if (error) {
            console.error('PATCH node failed:', error)
            return NextResponse.json({ error: 'Failed to update node' }, { status: 500 })
        }
        return NextResponse.json({ node: data })
    } catch (err) {
        console.error('PATCH /api/admin/org-chart/nodes/[id] error:', err)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}

// DELETE /api/admin/org-chart/nodes/[id]
export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
    try {
        const auth = await requireAdmin()
        if ('error' in auth) return auth.error

        const { id } = params
        const { error } = await auth.supabase
            .from('org_nodes')
            .delete()
            .eq('id', id)
        if (error) {
            console.error('DELETE node failed:', error)
            return NextResponse.json({ error: 'Failed to delete node' }, { status: 500 })
        }
        return NextResponse.json({ success: true })
    } catch (err) {
        console.error('DELETE /api/admin/org-chart/nodes/[id] error:', err)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
