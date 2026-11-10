'use client'

import { useMemo } from 'react'
import { useDroppable } from '@dnd-kit/core'
import OrgNodeView from './OrgNodeView'
import EmployeeCard, { type LiveStatus } from './EmployeeCard'
import type { TreeNode, EmployeeLite } from './types'

interface Props {
    roots: TreeNode[]
    editMode: boolean
    collapsedIds: Set<string>
    onToggleCollapse: (id: string) => void
    employeesByBusiness: Map<number, EmployeeLite[]>
    businessNameById: Map<number, string>
    onAddChild: (node: TreeNode) => void
    onRename: (node: TreeNode) => void
    onDelete: (node: TreeNode) => void
    onEmployeeClick: (id: string) => void
    nameMatch: (text: string) => boolean
    filteredEmployeeIds: Set<string> | null
    liveStatus: Record<string, LiveStatus> | null
    // True while a node is being dragged — surfaces the "insert between" edge zones.
    isDraggingNode?: boolean
}

// Drop zone sitting on the connector above a child node. Dropping a dragged node
// here inserts it between the child's parent and the child.
function EdgeDropZone({ childId, editMode, isDraggingNode }: { childId: string; editMode: boolean; isDraggingNode?: boolean }) {
    const { setNodeRef, isOver } = useDroppable({
        id: `edge-${childId}`,
        disabled: !editMode,
        data: { type: 'edge', childId },
    })
    return (
        <div ref={setNodeRef} className="relative flex justify-center" style={{ width: 56, height: 24 }}>
            <div className={`w-px h-full transition-colors ${isOver ? 'bg-primary' : 'bg-border'}`} />
            {editMode && isDraggingNode && (
                <div
                    className={`absolute inset-0 rounded-md transition-colors ${
                        isOver ? 'bg-primary/15 ring-2 ring-primary' : 'ring-1 ring-dashed ring-primary/30'
                    }`}
                />
            )}
            {isOver && (
                <div className="absolute -top-2 left-1/2 -translate-x-1/2 text-[10px] font-semibold text-primary bg-card border border-primary/40 px-1.5 py-0.5 rounded whitespace-nowrap pointer-events-none z-10">
                    insert here
                </div>
            )}
        </div>
    )
}

export default function TreeView(props: Props) {
    return (
        <div className="inline-flex flex-col gap-12 px-4 pb-10">
            {props.roots.map(root => (
                <Subtree key={root.id} node={root} depth={0} {...props} />
            ))}
        </div>
    )
}

function Subtree({
    node,
    depth,
    editMode,
    collapsedIds,
    onToggleCollapse,
    employeesByBusiness,
    businessNameById,
    onAddChild,
    onRename,
    onDelete,
    onEmployeeClick,
    nameMatch,
    filteredEmployeeIds,
    liveStatus,
    isDraggingNode,
}: Props & { node: TreeNode; depth: number }) {
    const isCollapsed = collapsedIds.has(node.id)

    // For location nodes, render employees as a grid below
    const employees = useMemo(() => {
        if (node.node_type !== 'location' || !node.business_id) return [] as EmployeeLite[]
        return employeesByBusiness.get(node.business_id) || []
    }, [node, employeesByBusiness])

    // Apply employee filter
    const filteredEmployees = useMemo(() => {
        if (filteredEmployeeIds === null) return employees
        return employees.filter(e => filteredEmployeeIds.has(e.id))
    }, [employees, filteredEmployeeIds])

    return (
        <div className="flex flex-col items-center">
            {/* Node */}
            <OrgNodeView
                node={node}
                editMode={editMode}
                collapsed={isCollapsed}
                onToggleCollapse={() => onToggleCollapse(node.id)}
                childCount={node.children.length + (employees.length > 0 ? 1 : 0)}
                onAddChild={() => onAddChild(node)}
                onRename={() => onRename(node)}
                onDelete={() => onDelete(node)}
            />

            {/* Children (sub-nodes + employees) */}
            {!isCollapsed && (node.children.length > 0 || filteredEmployees.length > 0) && (
                <>
                    {/* Vertical connector down */}
                    <div className="w-px h-6 bg-border" />

                    {/* Sub-nodes row */}
                    {node.children.length > 0 && (
                        <div className="relative">
                            {/* Horizontal connector spanning children */}
                            {node.children.length > 1 && (
                                <div className="absolute left-0 right-0 top-0 h-px bg-border" />
                            )}
                            <div className="flex items-start gap-6 pt-0">
                                {node.children.map(child => (
                                    <div key={child.id} className="flex flex-col items-center relative">
                                        {/* Connector + "insert between" drop zone */}
                                        <EdgeDropZone childId={child.id} editMode={editMode} isDraggingNode={isDraggingNode} />
                                        <Subtree
                                            node={child}
                                            depth={depth + 1}
                                            editMode={editMode}
                                            collapsedIds={collapsedIds}
                                            onToggleCollapse={onToggleCollapse}
                                            employeesByBusiness={employeesByBusiness}
                                            businessNameById={businessNameById}
                                            onAddChild={onAddChild}
                                            onRename={onRename}
                                            onDelete={onDelete}
                                            onEmployeeClick={onEmployeeClick}
                                            nameMatch={nameMatch}
                                            filteredEmployeeIds={filteredEmployeeIds}
                                            liveStatus={liveStatus}
                                            isDraggingNode={isDraggingNode}
                                            roots={[]}
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Employees grid (only when this node is a location) */}
                    {filteredEmployees.length > 0 && (
                        <div className="mt-3 flex flex-wrap justify-center gap-3 max-w-[460px]">
                            {filteredEmployees.map(e => (
                                <EmployeeCard
                                    key={`${node.id}-${e.id}`}
                                    employee={e}
                                    locationName={node.business_id ? businessNameById.get(node.business_id) || node.name : node.name}
                                    live={liveStatus?.[e.id] || null}
                                    onClick={() => onEmployeeClick(e.id)}
                                />
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    )
}
