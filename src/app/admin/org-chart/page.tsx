'use client'

import { useMemo, useState, useCallback } from 'react'
import useSWR, { mutate as globalMutate } from 'swr'
import type { LiveStatus } from './EmployeeCard'
import {
    DndContext,
    DragOverlay,
    PointerSensor,
    useSensor,
    useSensors,
    closestCenter,
    type DragEndEvent,
    type DragStartEvent,
} from '@dnd-kit/core'
import type { OrgNode } from '@/types/supabase'
import TreeView from './TreeView'
import OrgNodeView from './OrgNodeView'
import NodeDialog from './NodeDialog'
import EmployeeDetailPanel from './EmployeeDetailPanel'
import { buildTree, type OrgChartData, type EmployeeLite } from './types'
import { useChartPan, useChartCanvas, MIN_ZOOM, MAX_ZOOM } from '@/lib/hooks/useChartPan'
import { useAuth } from '@/contexts/AuthContext'

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then(r => {
    if (!r.ok) throw new Error('Failed to load')
    return r.json()
})

const ORG_CHART_KEY = '/api/admin/org-chart'
const LIVE_STATUS_KEY = '/api/admin/org-chart/live-status'

export default function OrgChartPage() {
    const { isScopedAdmin } = useAuth()
    const { data, error, isLoading, mutate } = useSWR<OrgChartData>(ORG_CHART_KEY, fetcher)
    const { data: liveData } = useSWR<{ liveStatus: Record<string, LiveStatus> }>(
        LIVE_STATUS_KEY,
        fetcher,
        { refreshInterval: 60_000 }
    )
    const liveStatus = liveData?.liveStatus || null

    const [editMode, setEditMode] = useState(false)
    const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())
    const [search, setSearch] = useState('')
    const [locationFilter, setLocationFilter] = useState<string>('')
    const [brandFilter, setBrandFilter] = useState<string>('')
    const [statusFilter, setStatusFilter] = useState<'all' | 'clocked-in' | 'has-shift-today' | 'no-shift-today'>('all')
    const [positionFilter, setPositionFilter] = useState<string>('')
    const [sortBy, setSortBy] = useState<'name' | 'newest' | 'oldest' | 'hours-desc'>('name')
    // Grab-to-pan + zoom. In edit mode, dragging a node card is owned by dnd-kit,
    // so panning is suppressed when the pointer starts on a card there.
    const { zoom, pan, zoomIn, zoomOut, zoomReset, handlers: panHandlers } = useChartPan(
        useCallback((el: HTMLElement) => editMode && !!el.closest('[data-org-node]'), [editMode])
    )
    const { viewportRef, contentRef, canvasHeight, offsetX } = useChartCanvas(zoom)
    const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null)
    const [dialog, setDialog] = useState<
        | { mode: 'create'; parent: OrgNode | null }
        | { mode: 'edit'; node: OrgNode }
        | null
    >(null)
    const [draggingNode, setDraggingNode] = useState<OrgNode | null>(null)

    const tree = useMemo(() => buildTree(data?.nodes || []), [data?.nodes])

    const businessNameById = useMemo(() => {
        const m = new Map<number, string>()
        for (const b of data?.businesses || []) {
            m.set(b.id, b.location ? `${b.name} — ${b.location}` : b.name)
        }
        return m
    }, [data?.businesses])

    // Active employees only — inactive staff are excluded from the chart entirely.
    const activeEmployees = useMemo(
        () => (data?.employees || []).filter(e => e.is_active),
        [data?.employees]
    )

    const employeesByBusiness = useMemo(() => {
        const m = new Map<number, EmployeeLite[]>()
        for (const e of activeEmployees) {
            for (const bid of e.business_ids) {
                const arr = m.get(bid) || []
                arr.push(e)
                m.set(bid, arr)
            }
        }
        return m
    }, [activeEmployees])

    // Unique positions across all employees (for the position filter dropdown)
    const positions = useMemo(() => {
        const set = new Set<string>()
        for (const e of activeEmployees) {
            if (e.position) set.add(e.position)
        }
        return Array.from(set).sort()
    }, [activeEmployees])

    // Brand nodes (top-level under root) for the brand filter dropdown.
    // Includes all 'brand' type nodes and the businesses they cover.
    const brands = useMemo(() => {
        const brandNodes = (data?.nodes || []).filter(n => n.node_type === 'brand')
        return brandNodes.map(brand => {
            // Find all location-node descendants of this brand and their business_ids
            const businessIds = new Set<number>()
            const queue = [brand.id]
            const childMap = new Map<string, string[]>()
            for (const n of data?.nodes || []) {
                if (n.parent_id) {
                    const arr = childMap.get(n.parent_id) || []
                    arr.push(n.id)
                    childMap.set(n.parent_id, arr)
                }
            }
            while (queue.length) {
                const cur = queue.shift()!
                for (const childId of childMap.get(cur) || []) {
                    const child = (data?.nodes || []).find(n => n.id === childId)
                    if (child) {
                        if (child.node_type === 'location' && child.business_id) {
                            businessIds.add(child.business_id)
                        }
                        queue.push(child.id)
                    }
                }
            }
            return { id: brand.id, name: brand.name, businessIds }
        })
    }, [data?.nodes])

    // Master filter: returns Set of matching employee IDs (or null if no filter active)
    const filteredEmployeeIds = useMemo(() => {
        const q = search.trim().toLowerCase()
        const noFilter = !q && !locationFilter && !brandFilter && statusFilter === 'all' && !positionFilter
        if (noFilter) return null

        const brandBusinessIds = brandFilter
            ? brands.find(b => b.id === brandFilter)?.businessIds || new Set<number>()
            : null

        const matches = new Set<string>()
        for (const e of activeEmployees) {
            const text = `${e.display_name || ''} ${e.full_name || ''} ${e.email || ''} ${e.position || ''}`.toLowerCase()
            if (q && !text.includes(q)) continue
            if (locationFilter && !e.business_ids.includes(Number(locationFilter))) continue
            if (brandBusinessIds && !e.business_ids.some(bid => brandBusinessIds.has(bid))) continue
            if (positionFilter && e.position !== positionFilter) continue
            const live = liveStatus?.[e.id]
            if (statusFilter === 'clocked-in' && !live?.openClockIn) continue
            if (statusFilter === 'has-shift-today' && !live?.todayShift) continue
            if (statusFilter === 'no-shift-today' && live?.todayShift) continue
            matches.add(e.id)
        }
        return matches
    }, [activeEmployees, search, locationFilter, brandFilter, positionFilter, statusFilter, liveStatus, brands])

    // Apply sorting to the employee → business map so cards render in the chosen order
    const employeesByBusinessSorted = useMemo(() => {
        const m = new Map<number, EmployeeLite[]>()
        for (const [bid, arr] of Array.from(employeesByBusiness.entries())) {
            const sorted = [...arr]
            sorted.sort((a, b) => {
                if (sortBy === 'name') {
                    return (a.display_name || a.full_name || '').localeCompare(b.display_name || b.full_name || '')
                }
                if (sortBy === 'newest') {
                    return (b.created_at || '').localeCompare(a.created_at || '')
                }
                if (sortBy === 'oldest') {
                    return (a.created_at || '').localeCompare(b.created_at || '')
                }
                if (sortBy === 'hours-desc') {
                    return (liveStatus?.[b.id]?.weekMinutes || 0) - (liveStatus?.[a.id]?.weekMinutes || 0)
                }
                return 0
            })
            m.set(bid, sorted)
        }
        return m
    }, [employeesByBusiness, sortBy, liveStatus])

    const activeFilterCount =
        (search.trim() ? 1 : 0) +
        (locationFilter ? 1 : 0) +
        (brandFilter ? 1 : 0) +
        (positionFilter ? 1 : 0) +
        (statusFilter !== 'all' ? 1 : 0)

    const clearFilters = useCallback(() => {
        setSearch('')
        setLocationFilter('')
        setBrandFilter('')
        setPositionFilter('')
        setStatusFilter('all')
    }, [])

    // Result count (employees visible)
    const visibleEmployeeCount = useMemo(() => {
        if (filteredEmployeeIds === null) return activeEmployees.length
        return filteredEmployeeIds.size
    }, [filteredEmployeeIds, activeEmployees])

    const toggleCollapse = useCallback((id: string) => {
        setCollapsedIds(prev => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }, [])

    const handleAddRoot = () => setDialog({ mode: 'create', parent: null })
    const handleAddChild = useCallback((node: OrgNode) => setDialog({ mode: 'create', parent: node }), [])
    const handleRename = useCallback((node: OrgNode) => setDialog({ mode: 'edit', node }), [])

    const handleDelete = useCallback(async (node: OrgNode) => {
        const ok = window.confirm(`Delete "${node.name}"? Children will be removed too.`)
        if (!ok) return
        try {
            const res = await fetch(`/api/admin/org-chart/nodes/${node.id}`, {
                method: 'DELETE',
                credentials: 'include',
            })
            if (!res.ok) throw new Error('Failed to delete')
            await mutate()
        } catch (err) {
            alert(err instanceof Error ? err.message : 'Failed to delete node')
        }
    }, [mutate])

    const handleSave = useCallback(async (payload: {
        id?: string
        node_type: OrgNode['node_type']
        name: string
        subtitle: string | null
        business_id: number | null
        parent_id: string | null
    }) => {
        const isUpdate = !!payload.id
        const url = isUpdate ? `/api/admin/org-chart/nodes/${payload.id}` : '/api/admin/org-chart/nodes'
        const method = isUpdate ? 'PATCH' : 'POST'
        const body: Record<string, unknown> = { ...payload }
        delete body.id
        const res = await fetch(url, {
            method,
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        })
        if (!res.ok) {
            const j = await res.json().catch(() => ({}))
            throw new Error(j?.error || 'Failed to save')
        }
        await mutate()
    }, [mutate])

    // DnD: drop a node on another to re-parent
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

    const handleDragStart = (event: DragStartEvent) => {
        const node = data?.nodes.find(n => n.id === event.active.id)
        if (node) setDraggingNode(node)
    }

    // Is `ancestorId` an ancestor of `nodeId` (walking up the tree)?
    const isAncestorOf = useCallback((ancestorId: string, nodeId: string | null): boolean => {
        const parentOf = new Map<string, string | null>()
        for (const n of data?.nodes || []) parentOf.set(n.id, n.parent_id)
        let cur = nodeId
        const seen = new Set<string>()
        while (cur) {
            if (cur === ancestorId) return true
            if (seen.has(cur)) break
            seen.add(cur)
            cur = parentOf.get(cur) ?? null
        }
        return false
    }, [data?.nodes])

    // Insert `draggedId` between `childId` and its current parent (the edge drop).
    const insertBetween = useCallback(async (draggedId: string, childId: string) => {
        const child = data?.nodes.find(n => n.id === childId)
        if (!child) return
        const newParentForDragged = child.parent_id  // P (may be null → dragged becomes a root)
        if (draggedId === childId) return
        if (newParentForDragged === draggedId) return // dragged is already child's parent → no-op
        // Can't drop a node into its own branch.
        if (newParentForDragged && isAncestorOf(draggedId, newParentForDragged)) {
            alert('You can’t insert a node inside its own branch.')
            return
        }

        const previous = data
        const optimistic: OrgChartData | undefined = data ? {
            ...data,
            nodes: data.nodes.map(n => {
                if (n.id === draggedId) return { ...n, parent_id: newParentForDragged }
                if (n.id === childId) return { ...n, parent_id: draggedId }
                return n
            }),
        } : data
        if (optimistic) await globalMutate(ORG_CHART_KEY, optimistic, false)

        try {
            // 1) Move the dragged node under the child's parent.
            let res = await fetch(`/api/admin/org-chart/nodes/${draggedId}`, {
                method: 'PATCH', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ parent_id: newParentForDragged }),
            })
            if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Failed to move node')
            // 2) Move the child under the dragged node.
            res = await fetch(`/api/admin/org-chart/nodes/${childId}`, {
                method: 'PATCH', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ parent_id: draggedId }),
            })
            if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Failed to insert node')
            await mutate()
        } catch (err) {
            if (previous) await globalMutate(ORG_CHART_KEY, previous, false)
            alert(err instanceof Error ? err.message : 'Failed to insert node')
        }
    }, [data, isAncestorOf, mutate])

    const handleDragEnd = async (event: DragEndEvent) => {
        const dragged = draggingNode
        setDraggingNode(null)
        if (!dragged || !event.over) return
        const overId = String(event.over.id)

        // Edge drop → insert the dragged node between two connected nodes.
        if (overId.startsWith('edge-')) {
            await insertBetween(dragged.id, overId.slice('edge-'.length))
            return
        }

        // Drop targets are `drop-<id>`; same-id means no-op
        const newParentId = overId.startsWith('drop-') ? overId.slice('drop-'.length) : overId
        if (newParentId === dragged.id || newParentId === dragged.parent_id) return

        // Optimistic update
        const previous = data
        const optimistic: OrgChartData | undefined = data ? {
            ...data,
            nodes: data.nodes.map(n => n.id === dragged.id ? { ...n, parent_id: newParentId } : n),
        } : data
        if (optimistic) {
            await globalMutate(ORG_CHART_KEY, optimistic, false)
        }
        try {
            const res = await fetch(`/api/admin/org-chart/nodes/${dragged.id}`, {
                method: 'PATCH',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ parent_id: newParentId }),
            })
            if (!res.ok) {
                const j = await res.json().catch(() => ({}))
                throw new Error(j?.error || 'Failed to move')
            }
            await mutate()
        } catch (err) {
            // Roll back
            if (previous) await globalMutate(ORG_CHART_KEY, previous, false)
            alert(err instanceof Error ? err.message : 'Failed to move node')
        }
    }

    const nameMatch = useCallback((text: string) => {
        if (!search.trim()) return true
        return text.toLowerCase().includes(search.toLowerCase())
    }, [search])

    if (isLoading) {
        return (
            <div className="min-h-[60vh] flex items-center justify-center">
                <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-primary" />
            </div>
        )
    }
    if (error || !data) {
        return <p className="text-destructive">Failed to load org chart.</p>
    }

    const businesses = data.businesses || []

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <h1 className="text-2xl font-bold">Organization Chart</h1>
                    <p className="text-sm text-muted-foreground">
                        {editMode ? 'Edit mode — drop a card on another to re-parent, or on a connector line to insert it between two nodes. Use the ⋯ menu to add/rename/delete.' : 'Drag anywhere to move the chart • click an employee for their schedule and hours.'}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1 border rounded-md p-0.5 bg-background">
                        <button
                            type="button"
                            onClick={zoomOut}
                            disabled={zoom <= MIN_ZOOM + 0.001}
                            className="px-2 py-0.5 rounded hover:bg-accent disabled:opacity-40 text-sm font-bold"
                            aria-label="Zoom out"
                            title="Zoom out"
                        >−</button>
                        <span className="text-xs tabular-nums w-10 text-center select-none">{Math.round(zoom * 100)}%</span>
                        <button
                            type="button"
                            onClick={zoomIn}
                            disabled={zoom >= MAX_ZOOM - 0.001}
                            className="px-2 py-0.5 rounded hover:bg-accent disabled:opacity-40 text-sm font-bold"
                            aria-label="Zoom in"
                            title="Zoom in"
                        >+</button>
                        <button
                            type="button"
                            onClick={zoomReset}
                            className="px-2 py-0.5 rounded hover:bg-accent text-xs"
                            aria-label="Reset zoom"
                            title="Reset zoom"
                        >Reset</button>
                    </div>
                    {/* Org chart is read-only for scoped (location) admins */}
                    {!isScopedAdmin && (
                        <button
                            type="button"
                            onClick={() => setEditMode(m => !m)}
                            className={editMode ? 'btn-primary btn-sm' : 'btn-outline btn-sm'}
                        >
                            {editMode ? 'Done editing' : 'Edit hierarchy'}
                        </button>
                    )}
                    {!isScopedAdmin && editMode && (
                        <button type="button" onClick={handleAddRoot} className="btn-secondary btn-sm">
                            + Add top-level
                        </button>
                    )}
                </div>
            </div>

            {/* Filter bar */}
            <div className="bg-card border rounded-lg p-3 flex flex-wrap items-center gap-2">
                <div className="relative">
                    <input
                        type="search"
                        placeholder="Search name, email, role…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="border rounded-md pl-8 pr-3 py-1.5 text-sm bg-background w-56"
                    />
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">🔍</span>
                </div>

                <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
                    className="border rounded-md px-3 py-1.5 text-sm bg-background"
                    title="Filter by status"
                >
                    <option value="all">📋 All status</option>
                    <option value="clocked-in">🟢 Clocked in now</option>
                    <option value="has-shift-today">📅 Has shift today</option>
                    <option value="no-shift-today">😴 No shift today</option>
                </select>

                <select
                    value={brandFilter}
                    onChange={(e) => setBrandFilter(e.target.value)}
                    className="border rounded-md px-3 py-1.5 text-sm bg-background"
                    title="Filter by brand"
                >
                    <option value="">🏢 All brands</option>
                    {brands.map(b => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                </select>

                <select
                    value={locationFilter}
                    onChange={(e) => setLocationFilter(e.target.value)}
                    className="border rounded-md px-3 py-1.5 text-sm bg-background"
                    title="Filter by location"
                >
                    <option value="">📍 All locations</option>
                    {businesses.map(b => (
                        <option key={b.id} value={b.id}>
                            {b.name}{b.location ? ` — ${b.location}` : ''}
                        </option>
                    ))}
                </select>

                {positions.length > 0 && (
                    <select
                        value={positionFilter}
                        onChange={(e) => setPositionFilter(e.target.value)}
                        className="border rounded-md px-3 py-1.5 text-sm bg-background"
                        title="Filter by position"
                    >
                        <option value="">👔 All positions</option>
                        {positions.map(p => (
                            <option key={p} value={p}>{p}</option>
                        ))}
                    </select>
                )}

                <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                    className="border rounded-md px-3 py-1.5 text-sm bg-background"
                    title="Sort employees"
                >
                    <option value="name">↕ Sort: Name (A–Z)</option>
                    <option value="newest">↕ Sort: Newest hire</option>
                    <option value="oldest">↕ Sort: Longest tenure</option>
                    <option value="hours-desc">↕ Sort: Most hours this week</option>
                </select>

                <div className="ml-auto flex items-center gap-3">
                    <span className="text-sm text-muted-foreground">
                        <span className="font-semibold text-foreground">{visibleEmployeeCount}</span>
                        {activeFilterCount > 0 ? ' matching' : ' total'} employee{visibleEmployeeCount !== 1 ? 's' : ''}
                    </span>
                    {activeFilterCount > 0 && (
                        <button
                            type="button"
                            onClick={clearFilters}
                            className="text-xs px-2 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 font-medium"
                        >
                            Clear filters ({activeFilterCount}) ✕
                        </button>
                    )}
                </div>
            </div>

            <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
            >
                <div
                    ref={viewportRef}
                    className="bg-muted/20 border rounded-lg overflow-auto relative"
                    style={{ height: canvasHeight, cursor: 'grab', touchAction: 'none' }}
                    {...panHandlers}
                >
                    {tree.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
                            <p>No nodes yet.</p>
                            <button onClick={handleAddRoot} className="btn-primary btn-sm mt-2">
                                + Create the first node
                            </button>
                        </div>
                    ) : (
                        <div
                            ref={contentRef}
                            className="absolute top-4 left-0 w-max"
                            style={{
                                transform: `translate(${offsetX + pan.x}px, ${pan.y}px) scale(${zoom})`,
                                transformOrigin: 'top left',
                            }}
                        >
                            <TreeView
                                roots={tree}
                                editMode={editMode}
                                collapsedIds={collapsedIds}
                                onToggleCollapse={toggleCollapse}
                                employeesByBusiness={employeesByBusinessSorted}
                                businessNameById={businessNameById}
                                onAddChild={handleAddChild}
                                onRename={handleRename}
                                onDelete={handleDelete}
                                onEmployeeClick={setSelectedEmployeeId}
                                nameMatch={nameMatch}
                                filteredEmployeeIds={filteredEmployeeIds}
                                liveStatus={liveStatus}
                                isDraggingNode={!!draggingNode}
                            />
                        </div>
                    )}
                </div>

                <DragOverlay>
                    {draggingNode && (
                        <OrgNodeView
                            node={draggingNode}
                            editMode={false}
                            collapsed={false}
                            onToggleCollapse={() => {}}
                            childCount={0}
                            onAddChild={() => {}}
                            onRename={() => {}}
                            onDelete={() => {}}
                            isDragOverlay
                        />
                    )}
                </DragOverlay>
            </DndContext>

            {/* Legend */}
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span><span className="inline-block w-3 h-3 rounded mr-1 bg-blue-200 border border-blue-300" />Person</span>
                <span><span className="inline-block w-3 h-3 rounded mr-1 bg-amber-200 border border-amber-300" />Role</span>
                <span><span className="inline-block w-3 h-3 rounded mr-1 bg-violet-200 border border-violet-300" />Brand</span>
                <span><span className="inline-block w-3 h-3 rounded mr-1 bg-emerald-200 border border-emerald-300" />Location</span>
            </div>

            {dialog && (
                <NodeDialog
                    mode={dialog.mode}
                    initialNode={dialog.mode === 'edit' ? dialog.node : undefined}
                    parentNode={dialog.mode === 'create' ? dialog.parent : null}
                    allNodes={data.nodes}
                    businesses={data.businesses}
                    onClose={() => setDialog(null)}
                    onSave={handleSave}
                />
            )}

            {selectedEmployeeId && (
                <EmployeeDetailPanel
                    employeeId={selectedEmployeeId}
                    onClose={() => setSelectedEmployeeId(null)}
                />
            )}
        </div>
    )
}
