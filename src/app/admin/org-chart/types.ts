import type { Business, OrgNode } from '@/types/supabase'

export type EmployeeLite = {
    id: string
    display_name: string | null
    position: string | null
    profile_picture_url: string | null
    is_active: boolean
    created_at: string
    work_location: string | null
    email: string | null
    full_name: string | null
    business_ids: number[]
    // Optional basic-info fields populated only by the employee-facing org chart.
    date_of_birth?: string | null
    manager_name?: string | null
    store_name?: string | null
    store_address?: string | null
}

export type OrgChartData = {
    nodes: OrgNode[]
    businesses: Business[]
    employees: EmployeeLite[]
}

export type TreeNode = OrgNode & {
    children: TreeNode[]
}

export function buildTree(nodes: OrgNode[]): TreeNode[] {
    const byId = new Map<string, TreeNode>()
    for (const n of nodes) byId.set(n.id, { ...n, children: [] })
    const roots: TreeNode[] = []
    // Sort siblings by sort_order then created_at to keep things stable
    const sortFn = (a: TreeNode, b: TreeNode) =>
        a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at)
    Array.from(byId.values()).forEach(n => {
        if (n.parent_id && byId.has(n.parent_id)) {
            byId.get(n.parent_id)!.children.push(n)
        } else {
            roots.push(n)
        }
    })
    const sortAll = (arr: TreeNode[]) => {
        arr.sort(sortFn)
        for (const c of arr) sortAll(c.children)
    }
    sortAll(roots)
    return roots
}

export const NODE_TYPE_LABEL: Record<OrgNode['node_type'], string> = {
    person: 'Person',
    role: 'Role',
    brand: 'Brand',
    location: 'Location',
}

export const NODE_TYPE_COLOR: Record<OrgNode['node_type'], string> = {
    person: 'bg-blue-100 dark:bg-blue-900/40 border-blue-300 dark:border-blue-700',
    role: 'bg-amber-100 dark:bg-amber-900/40 border-amber-300 dark:border-amber-700',
    brand: 'bg-violet-100 dark:bg-violet-900/40 border-violet-300 dark:border-violet-700',
    location: 'bg-emerald-100 dark:bg-emerald-900/40 border-emerald-300 dark:border-emerald-700',
}
