'use client'

import { useEffect, useState } from 'react'
import type { Business, OrgNode } from '@/types/supabase'

interface Props {
    mode: 'create' | 'edit'
    initialNode?: OrgNode
    parentNode?: OrgNode | null
    allNodes: OrgNode[]
    businesses: Business[]
    onClose: () => void
    onSave: (payload: {
        id?: string
        node_type: OrgNode['node_type']
        name: string
        subtitle: string | null
        business_id: number | null
        parent_id: string | null
    }) => Promise<void>
}

export default function NodeDialog({
    mode,
    initialNode,
    parentNode,
    allNodes,
    businesses,
    onClose,
    onSave,
}: Props) {
    const [nodeType, setNodeType] = useState<OrgNode['node_type']>(initialNode?.node_type || 'location')
    const [name, setName] = useState(initialNode?.name || '')
    const [subtitle, setSubtitle] = useState(initialNode?.subtitle || '')
    const [businessId, setBusinessId] = useState<number | null>(initialNode?.business_id ?? null)
    const [parentId, setParentId] = useState<string | null>(
        mode === 'edit' ? (initialNode?.parent_id ?? null) : (parentNode?.id ?? null)
    )
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }, [onClose])

    // Build valid parent options (exclude self + descendants when editing)
    const validParents = (() => {
        if (mode !== 'edit' || !initialNode) return allNodes
        const childMap = new Map<string, string[]>()
        for (const n of allNodes) {
            if (n.parent_id) {
                const arr = childMap.get(n.parent_id) || []
                arr.push(n.id)
                childMap.set(n.parent_id, arr)
            }
        }
        const descendants = new Set<string>([initialNode.id])
        const queue = [initialNode.id]
        while (queue.length) {
            const cur = queue.shift()!
            for (const c of childMap.get(cur) || []) {
                if (!descendants.has(c)) {
                    descendants.add(c)
                    queue.push(c)
                }
            }
        }
        return allNodes.filter(n => !descendants.has(n.id))
    })()

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError(null)
        if (!name.trim()) {
            setError('Name is required.')
            return
        }
        setSaving(true)
        try {
            await onSave({
                id: initialNode?.id,
                node_type: nodeType,
                name: name.trim(),
                subtitle: subtitle.trim() || null,
                business_id: nodeType === 'location' ? businessId : null,
                parent_id: parentId,
            })
            onClose()
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save')
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
            <div className="absolute inset-0 bg-black/50" onClick={onClose} />
            <div className="relative bg-card rounded-t-xl sm:rounded-lg shadow-xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto">
                <form onSubmit={handleSubmit}>
                    <div className="border-b px-4 py-3 flex items-center justify-between">
                        <h3 className="font-semibold">{mode === 'create' ? 'Add node' : 'Edit node'}</h3>
                        <button type="button" onClick={onClose} className="p-1 rounded hover:bg-accent">✕</button>
                    </div>

                    <div className="p-4 space-y-3">
                        <div>
                            <label className="block text-sm font-medium mb-1">Type</label>
                            <select
                                value={nodeType}
                                onChange={(e) => setNodeType(e.target.value as OrgNode['node_type'])}
                                className="w-full border rounded px-3 py-2 bg-background"
                            >
                                <option value="person">Person</option>
                                <option value="role">Role</option>
                                <option value="brand">Brand</option>
                                <option value="location">Location</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-1">Name</label>
                            <input
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className="w-full border rounded px-3 py-2 bg-background"
                                placeholder="e.g. Operations Lead, PlayFunia, Garden State Plaza"
                                autoFocus
                                maxLength={200}
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-1">Subtitle <span className="text-muted-foreground font-normal">(optional)</span></label>
                            <input
                                value={subtitle}
                                onChange={(e) => setSubtitle(e.target.value)}
                                className="w-full border rounded px-3 py-2 bg-background"
                                placeholder="e.g. Owners, Operations, etc."
                                maxLength={200}
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-1">Parent</label>
                            <select
                                value={parentId ?? ''}
                                onChange={(e) => setParentId(e.target.value || null)}
                                className="w-full border rounded px-3 py-2 bg-background"
                            >
                                <option value="">(Top-level — no parent)</option>
                                {validParents.map(n => (
                                    <option key={n.id} value={n.id}>
                                        {n.name} ({n.node_type})
                                    </option>
                                ))}
                            </select>
                        </div>

                        {nodeType === 'location' && (
                            <div>
                                <label className="block text-sm font-medium mb-1">
                                    Linked business <span className="text-muted-foreground font-normal">(employees assigned to this business appear here)</span>
                                </label>
                                <select
                                    value={businessId ?? ''}
                                    onChange={(e) => setBusinessId(e.target.value ? Number(e.target.value) : null)}
                                    className="w-full border rounded px-3 py-2 bg-background"
                                >
                                    <option value="">(Not linked)</option>
                                    {businesses.map(b => (
                                        <option key={b.id} value={b.id}>
                                            {b.name}{b.location ? ` — ${b.location}` : ''}
                                        </option>
                                    ))}
                                </select>
                                <p className="text-xs text-muted-foreground mt-1">
                                    If no matching business exists, create the location node first, then add the business via the admin Employees → assignment dialog or contact admin.
                                </p>
                            </div>
                        )}

                        {error && <p className="text-sm text-destructive">{error}</p>}
                    </div>

                    <div className="border-t px-4 py-3 flex justify-end gap-2">
                        <button type="button" onClick={onClose} className="btn-outline btn-sm">Cancel</button>
                        <button type="submit" disabled={saving} className="btn-primary btn-sm">
                            {saving ? 'Saving…' : 'Save'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}
