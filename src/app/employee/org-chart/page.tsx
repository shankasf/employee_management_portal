'use client'

import { useMemo, useState, useCallback } from 'react'
import useSWR from 'swr'
import TreeView from '@/app/admin/org-chart/TreeView'
import { buildTree, type OrgChartData, type EmployeeLite } from '@/app/admin/org-chart/types'
import { useChartPan, useChartCanvas, MIN_ZOOM, MAX_ZOOM } from '@/lib/hooks/useChartPan'
import { getProfilePicSrc } from '@/lib/utils'

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then(r => {
    if (!r.ok) throw new Error('Failed to load')
    return r.json()
})

const ORG_CHART_KEY = '/api/employee/org-chart'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
function formatBirthday(dob: string | null | undefined): string | null {
    if (!dob) return null
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dob)
    if (!m) return null
    const month = Number(m[2]), day = Number(m[3])
    if (month < 1 || month > 12) return null
    return `${MONTHS[month - 1]} ${day}`
}

export default function EmployeeOrgChartPage() {
    const { data, error, isLoading } = useSWR<OrgChartData>(ORG_CHART_KEY, fetcher)
    const [search, setSearch] = useState('')
    const [selected, setSelected] = useState<EmployeeLite | null>(null)
    const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())
    const { zoom, pan, zoomIn, zoomOut, zoomReset, handlers: panHandlers } = useChartPan()
    const { viewportRef, contentRef, canvasHeight, offsetX } = useChartCanvas(zoom)

    const toggleCollapse = useCallback((id: string) => {
        setCollapsedIds(prev => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }, [])

    const tree = useMemo(() => buildTree(data?.nodes || []), [data?.nodes])

    const businessNameById = useMemo(() => {
        const map = new Map<number, string>()
        for (const b of data?.businesses || []) {
            map.set(b.id, b.location ? `${b.name} — ${b.location}` : b.name)
        }
        return map
    }, [data?.businesses])

    // Active employees only — inactive staff are excluded from the chart entirely.
    const activeEmployees = useMemo(
        () => (data?.employees || []).filter(e => e.is_active),
        [data?.employees]
    )

    const employeesByBusiness = useMemo(() => {
        const map = new Map<number, EmployeeLite[]>()
        for (const e of activeEmployees) {
            for (const bid of e.business_ids) {
                const arr = map.get(bid) || []
                arr.push(e)
                map.set(bid, arr)
            }
        }
        for (const arr of Array.from(map.values())) {
            arr.sort((a, b) => (a.display_name || a.full_name || '').localeCompare(b.display_name || b.full_name || ''))
        }
        return map
    }, [activeEmployees])

    const employeeById = useMemo(() => {
        const map = new Map<string, EmployeeLite>()
        for (const e of activeEmployees) map.set(e.id, e)
        return map
    }, [activeEmployees])

    // Search → set of matching employee ids (or null when no query)
    const filteredEmployeeIds = useMemo(() => {
        const q = search.trim().toLowerCase()
        if (!q) return null
        const matches = new Set<string>()
        for (const e of activeEmployees) {
            const text = `${e.display_name || ''} ${e.full_name || ''} ${e.position || ''} ${e.store_name || ''}`.toLowerCase()
            if (text.includes(q)) matches.add(e.id)
        }
        return matches
    }, [activeEmployees, search])

    const nameMatch = useCallback((text: string) => {
        if (!search.trim()) return true
        return text.toLowerCase().includes(search.toLowerCase())
    }, [search])

    const noop = useCallback(() => {}, [])

    if (isLoading) {
        return (
            <div className="min-h-[60vh] flex items-center justify-center">
                <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-primary" />
            </div>
        )
    }
    if (error || !data) {
        return <p className="text-destructive">Failed to load the org chart.</p>
    }

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <h1 className="text-2xl font-bold">Organization Chart</h1>
                    <p className="text-sm text-muted-foreground">
                        Drag anywhere to move the chart • click a teammate for their details.
                    </p>
                </div>
                <div className="flex items-center gap-1 border rounded-md p-0.5 bg-background">
                    <button type="button" onClick={zoomOut} disabled={zoom <= MIN_ZOOM + 0.001}
                        className="px-2 py-0.5 rounded hover:bg-accent disabled:opacity-40 text-sm font-bold" aria-label="Zoom out">−</button>
                    <span className="text-xs tabular-nums w-10 text-center select-none">{Math.round(zoom * 100)}%</span>
                    <button type="button" onClick={zoomIn} disabled={zoom >= MAX_ZOOM - 0.001}
                        className="px-2 py-0.5 rounded hover:bg-accent disabled:opacity-40 text-sm font-bold" aria-label="Zoom in">+</button>
                    <button type="button" onClick={zoomReset} className="px-2 py-0.5 rounded hover:bg-accent text-xs">Reset</button>
                </div>
            </div>

            <div className="bg-card border rounded-lg p-3 flex flex-wrap items-center gap-2">
                <div className="relative">
                    <input
                        type="search"
                        placeholder="Search name, role, store…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="border rounded-md pl-8 pr-3 py-1.5 text-sm bg-background w-56"
                    />
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">🔍</span>
                </div>
            </div>

            <div
                ref={viewportRef}
                className="bg-muted/20 border rounded-lg overflow-auto relative"
                style={{ height: canvasHeight, cursor: 'grab', touchAction: 'none' }}
                {...panHandlers}
            >
                {tree.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-muted-foreground">
                        <p>The org chart hasn&apos;t been set up yet.</p>
                    </div>
                ) : (
                    <div
                        ref={contentRef}
                        className="absolute top-4 left-0 w-max"
                        style={{ transform: `translate(${offsetX + pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: 'top left' }}
                    >
                        <TreeView
                            roots={tree}
                            editMode={false}
                            collapsedIds={collapsedIds}
                            onToggleCollapse={toggleCollapse}
                            employeesByBusiness={employeesByBusiness}
                            businessNameById={businessNameById}
                            onAddChild={noop}
                            onRename={noop}
                            onDelete={noop}
                            onEmployeeClick={(id) => setSelected(employeeById.get(id) || null)}
                            nameMatch={nameMatch}
                            filteredEmployeeIds={filteredEmployeeIds}
                            liveStatus={null}
                        />
                    </div>
                )}
            </div>

            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span><span className="inline-block w-3 h-3 rounded mr-1 bg-blue-200 border border-blue-300" />Person</span>
                <span><span className="inline-block w-3 h-3 rounded mr-1 bg-amber-200 border border-amber-300" />Role</span>
                <span><span className="inline-block w-3 h-3 rounded mr-1 bg-violet-200 border border-violet-300" />Brand</span>
                <span><span className="inline-block w-3 h-3 rounded mr-1 bg-emerald-200 border border-emerald-300" />Location</span>
            </div>

            {selected && (
                <BasicEmployeeModal employee={selected} onClose={() => setSelected(null)} />
            )}
        </div>
    )
}

function BasicEmployeeModal({ employee, onClose }: { employee: EmployeeLite; onClose: () => void }) {
    const name = employee.display_name || employee.full_name || 'Unnamed'
    const picUrl = getProfilePicSrc(employee.profile_picture_url)
    const birthday = formatBirthday(employee.date_of_birth)
    const rows: { icon: string; label: string; value: string }[] = []
    if (employee.position) rows.push({ icon: '👔', label: 'Role', value: employee.position })
    if (birthday) rows.push({ icon: '🎂', label: 'Birthday', value: birthday })
    if (employee.manager_name) rows.push({ icon: '👤', label: 'Manager', value: employee.manager_name })
    if (employee.store_name) rows.push({ icon: '🏬', label: 'Store', value: employee.store_name })
    if (employee.store_address) rows.push({ icon: '📍', label: 'Address', value: employee.store_address })
    if (employee.email) rows.push({ icon: '✉️', label: 'Email', value: employee.email })

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
            <div
                className="bg-card border rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="px-5 pt-5 pb-4 bg-gradient-to-br from-indigo-50 via-card to-fuchsia-50 dark:from-indigo-950/40 dark:to-fuchsia-950/40 flex items-center gap-3">
                    {picUrl ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={picUrl} alt={name} className="w-14 h-14 rounded-full object-cover ring-2 ring-white dark:ring-slate-800 shadow" />
                    ) : (
                        <div className="w-14 h-14 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-bold text-xl ring-2 ring-white dark:ring-slate-800 shadow">
                            {name[0]?.toUpperCase() || '?'}
                        </div>
                    )}
                    <div className="min-w-0">
                        <p className="font-bold text-lg leading-tight truncate">{name}</p>
                        {!employee.is_active && <span className="text-xs text-red-500">Inactive</span>}
                    </div>
                </div>
                <div className="px-5 py-4 space-y-2.5">
                    {rows.map((r) => (
                        <div key={r.label} className="flex items-start gap-2.5 text-sm">
                            <span className="w-5 text-center">{r.icon}</span>
                            <span className="text-muted-foreground w-20 flex-shrink-0">{r.label}</span>
                            <span className="font-medium break-words">{r.value}</span>
                        </div>
                    ))}
                    {rows.length === 0 && <p className="text-sm text-muted-foreground">No additional details available.</p>}
                </div>
                <div className="px-5 pb-5">
                    <button type="button" onClick={onClose} className="btn-outline btn-sm w-full">Close</button>
                </div>
            </div>
        </div>
    )
}
