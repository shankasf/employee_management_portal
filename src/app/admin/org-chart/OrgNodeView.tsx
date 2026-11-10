'use client'

import { useRef, useState } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import type { OrgNode } from '@/types/supabase'
import { NODE_TYPE_COLOR, NODE_TYPE_LABEL } from './types'

interface Props {
    node: OrgNode
    editMode: boolean
    collapsed: boolean
    onToggleCollapse: () => void
    childCount: number
    onAddChild: () => void
    onRename: () => void
    onDelete: () => void
    isDropTarget?: boolean
    isDragOverlay?: boolean
}

export default function OrgNodeView({
    node,
    editMode,
    collapsed,
    onToggleCollapse,
    childCount,
    onAddChild,
    onRename,
    onDelete,
    isDragOverlay = false,
}: Props) {
    const [menuOpen, setMenuOpen] = useState(false)
    const menuRef = useRef<HTMLDivElement>(null)

    // Drag (edit mode only, non-root)
    const draggable = useDraggable({
        id: node.id,
        disabled: !editMode || isDragOverlay,
        data: { type: 'node', node },
    })

    // Drop target (edit mode only)
    const droppable = useDroppable({
        id: `drop-${node.id}`,
        disabled: !editMode || isDragOverlay,
        data: { type: 'node', nodeId: node.id },
    })

    const refSetter = (el: HTMLDivElement | null) => {
        draggable.setNodeRef(el)
        droppable.setNodeRef(el)
    }

    const dragStyle = draggable.transform
        ? { transform: `translate3d(${draggable.transform.x}px, ${draggable.transform.y}px, 0)`, zIndex: 50 }
        : undefined

    const colorClass = NODE_TYPE_COLOR[node.node_type]

    return (
        <div
            ref={refSetter}
            data-org-node
            style={dragStyle}
            className={`relative rounded-lg border-2 px-3 py-2 min-w-[180px] max-w-[240px] shadow-sm ${colorClass} ${
                droppable.isOver ? 'ring-2 ring-primary ring-offset-2' : ''
            } ${draggable.isDragging ? 'opacity-40' : ''}`}
        >
            {/* Type chip */}
            <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] uppercase tracking-wide font-semibold text-foreground/70">
                    {NODE_TYPE_LABEL[node.node_type]}
                </span>
                {editMode && !isDragOverlay && (
                    <div className="relative">
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setMenuOpen(o => !o) }}
                            className="text-foreground/60 hover:text-foreground p-0.5 rounded hover:bg-black/5"
                            aria-label="Node actions"
                        >
                            ⋯
                        </button>
                        {menuOpen && (
                            <div
                                ref={menuRef}
                                className="absolute right-0 top-full mt-1 bg-popover border rounded-md shadow-lg py-1 z-20 text-xs min-w-[140px]"
                                onMouseLeave={() => setMenuOpen(false)}
                            >
                                <button
                                    type="button"
                                    className="block w-full text-left px-3 py-1.5 hover:bg-accent"
                                    onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onAddChild() }}
                                >
                                    + Add child
                                </button>
                                <button
                                    type="button"
                                    className="block w-full text-left px-3 py-1.5 hover:bg-accent"
                                    onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onRename() }}
                                >
                                    Rename / edit
                                </button>
                                <button
                                    type="button"
                                    className="block w-full text-left px-3 py-1.5 text-destructive hover:bg-destructive/10"
                                    onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onDelete() }}
                                >
                                    Delete
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Drag handle area (only meaningful in edit mode; covers card body) */}
            <div
                {...(editMode && !isDragOverlay ? { ...draggable.listeners, ...draggable.attributes } : {})}
                className={editMode ? 'cursor-grab active:cursor-grabbing' : ''}
            >
                <div className="font-semibold text-sm leading-tight break-words">{node.name}</div>
                {node.subtitle && (
                    <div className="text-xs text-foreground/70 mt-0.5 break-words">{node.subtitle}</div>
                )}
            </div>

            {/* Collapse toggle for nodes with children */}
            {childCount > 0 && !isDragOverlay && (
                <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onToggleCollapse() }}
                    className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-card border-2 border-current rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shadow"
                    aria-label={collapsed ? 'Expand' : 'Collapse'}
                    title={collapsed ? `Expand (${childCount})` : 'Collapse'}
                >
                    {collapsed ? `+${childCount}` : '−'}
                </button>
            )}
        </div>
    )
}
