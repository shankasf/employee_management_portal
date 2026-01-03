'use client'

import { useState } from 'react'
import { createUntypedClient } from '@/lib/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { useTasks, useActiveEmployees, invalidateQueries } from '@/lib/hooks/useData'

interface Task {
    id: string
    title: string
    description: string | null
    is_recurring: boolean
    frequency: string | null
    location: string | null
    role_target: string | null
    cutoff_time: string | null
    requires_photo: boolean
    requires_video: boolean
    requires_notes: boolean
    created_at: string
}

interface ActiveEmployee {
    id: string
    display_name: string | null
    position: string | null
}

export default function TasksPage() {
    const { user } = useAuth()
    const { data: tasks = [], isLoading: loading, mutate } = useTasks()
    const { data: employees = [] } = useActiveEmployees()
    const [showModal, setShowModal] = useState(false)
    const [showAssignModal, setShowAssignModal] = useState(false)
    const [editingTask, setEditingTask] = useState<Task | null>(null)
    const [assigningTask, setAssigningTask] = useState<Task | null>(null)
    const [saving, setSaving] = useState(false)

    // Form state
    const [formData, setFormData] = useState({
        title: '',
        description: '',
        is_recurring: false,
        frequency: 'daily',
        location: '',
        role_target: 'all',
        cutoff_time: '',
        requires_photo: false,
        requires_video: false,
        requires_notes: false
    })

    // Assignment form state
    const [assignData, setAssignData] = useState({
        employee_id: '',
        scheduled_date: new Date().toISOString().split('T')[0]
    })

    function openModal(task?: Task) {
        if (task) {
            setEditingTask(task)
            setFormData({
                title: task.title,
                description: task.description || '',
                is_recurring: task.is_recurring,
                frequency: task.frequency || 'daily',
                location: task.location || '',
                role_target: task.role_target || 'all',
                cutoff_time: task.cutoff_time || '',
                requires_photo: task.requires_photo,
                requires_video: task.requires_video,
                requires_notes: task.requires_notes
            })
        } else {
            setEditingTask(null)
            setFormData({
                title: '',
                description: '',
                is_recurring: false,
                frequency: 'daily',
                location: '',
                role_target: 'all',
                cutoff_time: '',
                requires_photo: false,
                requires_video: false,
                requires_notes: false
            })
        }
        setShowModal(true)
    }

    function closeModal() {
        setShowModal(false)
        setEditingTask(null)
    }

    function openAssignModal(task: Task) {
        setAssigningTask(task)
        setAssignData({
            employee_id: '',
            scheduled_date: new Date().toISOString().split('T')[0]
        })
        setShowAssignModal(true)
    }

    function closeAssignModal() {
        setShowAssignModal(false)
        setAssigningTask(null)
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setSaving(true)
        try {
            const supabase = createUntypedClient()

            const taskData = {
                title: formData.title,
                description: formData.description || null,
                is_recurring: formData.is_recurring,
                frequency: formData.is_recurring ? formData.frequency : null,
                location: formData.location || null,
                role_target: formData.role_target || null,
                cutoff_time: formData.cutoff_time || null,
                requires_photo: formData.requires_photo,
                requires_video: formData.requires_video,
                requires_notes: formData.requires_notes,
                created_by: user?.id
            }

            if (editingTask) {
                const { error } = await supabase
                    .from('tasks')
                    .update(taskData)
                    .eq('id', editingTask.id)
                if (error) throw error
            } else {
                const { error } = await supabase
                    .from('tasks')
                    .insert(taskData)
                if (error) throw error
            }

            alert(editingTask ? 'Task updated!' : 'Task created!')
            closeModal()
            invalidateQueries.tasks()
            mutate()
        } catch (err: unknown) {
            const error = err as Error
            console.error('Error saving task:', error)
            alert('Error: ' + error.message)
        } finally {
            setSaving(false)
        }
    }

    async function handleAssign(e: React.FormEvent) {
        e.preventDefault()
        if (!assigningTask) return
        setSaving(true)
        try {
            const supabase = createUntypedClient()

            const { error } = await supabase
                .from('task_instances')
                .insert({
                    task_id: assigningTask.id,
                    employee_id: assignData.employee_id,
                    scheduled_date: assignData.scheduled_date,
                    status: 'pending'
                })

            if (error) throw error

            alert('Task assigned successfully!')
            closeAssignModal()
        } catch (err: unknown) {
            const error = err as Error
            console.error('Error assigning task:', error)
            alert('Error: ' + error.message)
        } finally {
            setSaving(false)
        }
    }

    async function deleteTask(id: string) {
        if (!confirm('Are you sure you want to delete this task?')) return
        try {
            const supabase = createUntypedClient()
            const { error } = await supabase
                .from('tasks')
                .delete()
                .eq('id', id)
            if (error) throw error
            invalidateQueries.tasks()
            mutate()
        } catch (err) {
            console.error('Error deleting task:', err)
            alert('Failed to delete task')
        }
    }

    return (
        <div className="space-y-4 sm:space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold">Tasks</h1>
                    <p className="text-muted-foreground mt-1 text-sm sm:text-base">
                        Create and manage task definitions
                    </p>
                </div>
                <button className="btn-primary w-full sm:w-auto" onClick={() => openModal()}>
                    + Create Task
                </button>
            </div>

            {loading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                    {[...Array(6)].map((_, i) => (
                        <div key={i} className="h-40 sm:h-48 bg-muted rounded-lg animate-pulse"></div>
                    ))}
                </div>
            ) : tasks.length === 0 ? (
                <div className="card p-6 sm:p-8 text-center">
                    <p className="text-muted-foreground mb-4 text-sm sm:text-base">No tasks created yet</p>
                    <button className="btn-primary" onClick={() => openModal()}>
                        Create Your First Task
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                    {tasks.map((task: Task) => (
                        <div key={task.id} className="card hover:shadow-md transition-shadow">
                            <div className="p-3 sm:p-4">
                                <div className="flex items-start justify-between mb-2 gap-2">
                                    <h3 className="font-semibold text-sm sm:text-base line-clamp-1">{task.title}</h3>
                                    {task.is_recurring && (
                                        <span className="badge-default text-xs flex-shrink-0">🔄 {task.frequency}</span>
                                    )}
                                </div>
                                {task.description && (
                                    <p className="text-xs sm:text-sm text-muted-foreground mb-2 sm:mb-3 line-clamp-2">
                                        {task.description}
                                    </p>
                                )}
                                <div className="space-y-1 text-xs text-muted-foreground">
                                    {task.location && (
                                        <p className="truncate">📍 {task.location}</p>
                                    )}
                                    {task.cutoff_time && (
                                        <p>⏰ Due by {task.cutoff_time}</p>
                                    )}
                                    {task.role_target && (
                                        <p>👤 {task.role_target}</p>
                                    )}
                                </div>
                                <div className="flex gap-1 sm:gap-2 mt-2 sm:mt-3 flex-wrap">
                                    {task.requires_photo && (
                                        <span className="badge-outline text-xs">📷</span>
                                    )}
                                    {task.requires_video && (
                                        <span className="badge-outline text-xs">🎥</span>
                                    )}
                                    {task.requires_notes && (
                                        <span className="badge-outline text-xs">📝</span>
                                    )}
                                </div>
                                <div className="flex gap-1 sm:gap-2 mt-3 sm:mt-4 pt-2 sm:pt-3 border-t">
                                    <button
                                        className="btn-ghost btn-sm flex-1 text-xs sm:text-sm"
                                        onClick={() => openModal(task)}
                                    >
                                        Edit
                                    </button>
                                    <button
                                        className="btn-ghost btn-sm flex-1 text-xs sm:text-sm"
                                        onClick={() => openAssignModal(task)}
                                    >
                                        Assign
                                    </button>
                                    <button
                                        className="btn-ghost btn-sm text-destructive px-2"
                                        onClick={() => deleteTask(task.id)}
                                    >
                                        🗑️
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Create/Edit Task Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
                    <div className="bg-card rounded-t-xl sm:rounded-lg shadow-lg w-full sm:max-w-lg max-h-[90vh] sm:max-h-[85vh] overflow-y-auto animate-slide-up sm:animate-none">
                        <div className="p-4 sm:p-6">
                            <h2 className="text-lg sm:text-xl font-bold mb-4">
                                {editingTask ? 'Edit Task' : 'Create New Task'}
                            </h2>
                            <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-4">
                                <div>
                                    <label className="label">Title *</label>
                                    <input
                                        type="text"
                                        required
                                        className="input"
                                        value={formData.title}
                                        onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="label">Description</label>
                                    <textarea
                                        className="input min-h-[80px]"
                                        value={formData.description}
                                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="label">Location</label>
                                    <input
                                        type="text"
                                        className="input"
                                        placeholder="e.g., Main Floor, Party Room A"
                                        value={formData.location}
                                        onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="label">Target Role</label>
                                        <select
                                            className="input"
                                            value={formData.role_target}
                                            onChange={(e) => setFormData({ ...formData, role_target: e.target.value })}
                                        >
                                            <option value="all">All Staff</option>
                                            <option value="employee">Employees Only</option>
                                            <option value="admin">Admins Only</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="label">Cutoff Time</label>
                                        <input
                                            type="time"
                                            className="input"
                                            value={formData.cutoff_time}
                                            onChange={(e) => setFormData({ ...formData, cutoff_time: e.target.value })}
                                        />
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        id="is_recurring"
                                        checked={formData.is_recurring}
                                        onChange={(e) => setFormData({ ...formData, is_recurring: e.target.checked })}
                                        className="rounded border-gray-300"
                                    />
                                    <label htmlFor="is_recurring" className="text-sm">Recurring task</label>
                                </div>
                                {formData.is_recurring && (
                                    <div>
                                        <label className="label">Frequency</label>
                                        <select
                                            className="input"
                                            value={formData.frequency}
                                            onChange={(e) => setFormData({ ...formData, frequency: e.target.value })}
                                        >
                                            <option value="daily">Daily</option>
                                            <option value="weekly">Weekly</option>
                                            <option value="monthly">Monthly</option>
                                        </select>
                                    </div>
                                )}
                                <div className="space-y-2">
                                    <p className="label">Requirements</p>
                                    <div className="flex flex-wrap gap-4">
                                        <label className="flex items-center gap-2">
                                            <input
                                                type="checkbox"
                                                checked={formData.requires_photo}
                                                onChange={(e) => setFormData({ ...formData, requires_photo: e.target.checked })}
                                                className="rounded border-gray-300"
                                            />
                                            <span className="text-sm">📷 Photo</span>
                                        </label>
                                        <label className="flex items-center gap-2">
                                            <input
                                                type="checkbox"
                                                checked={formData.requires_video}
                                                onChange={(e) => setFormData({ ...formData, requires_video: e.target.checked })}
                                                className="rounded border-gray-300"
                                            />
                                            <span className="text-sm">🎥 Video</span>
                                        </label>
                                        <label className="flex items-center gap-2">
                                            <input
                                                type="checkbox"
                                                checked={formData.requires_notes}
                                                onChange={(e) => setFormData({ ...formData, requires_notes: e.target.checked })}
                                                className="rounded border-gray-300"
                                            />
                                            <span className="text-sm">📝 Notes</span>
                                        </label>
                                    </div>
                                </div>
                                <div className="flex gap-3 pt-4">
                                    <button
                                        type="button"
                                        className="btn-secondary flex-1"
                                        onClick={closeModal}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        className="btn-primary flex-1"
                                        disabled={saving}
                                    >
                                        {saving ? 'Saving...' : editingTask ? 'Update Task' : 'Create Task'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}

            {/* Assign Task Modal */}
            {showAssignModal && assigningTask && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-card rounded-lg shadow-lg w-full max-w-md">
                        <div className="p-6">
                            <h2 className="text-xl font-bold mb-2">Assign Task</h2>
                            <p className="text-muted-foreground mb-4">{assigningTask.title}</p>
                            <form onSubmit={handleAssign} className="space-y-4">
                                <div>
                                    <label className="label">Employee *</label>
                                    <select
                                        required
                                        className="input"
                                        value={assignData.employee_id}
                                        onChange={(e) => setAssignData({ ...assignData, employee_id: e.target.value })}
                                    >
                                        <option value="">Select an employee</option>
                                        {employees.map((emp: ActiveEmployee) => (
                                            <option key={emp.id} value={emp.id}>
                                                {emp.display_name || 'Unnamed'} {emp.position ? `(${emp.position})` : ''}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="label">Scheduled Date *</label>
                                    <input
                                        type="date"
                                        required
                                        className="input"
                                        value={assignData.scheduled_date}
                                        onChange={(e) => setAssignData({ ...assignData, scheduled_date: e.target.value })}
                                    />
                                </div>
                                <div className="flex gap-3 pt-4">
                                    <button
                                        type="button"
                                        className="btn-secondary flex-1"
                                        onClick={closeAssignModal}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        className="btn-primary flex-1"
                                        disabled={saving}
                                    >
                                        {saving ? 'Assigning...' : 'Assign Task'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
