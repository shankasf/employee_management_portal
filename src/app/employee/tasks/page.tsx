'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { createUntypedClient } from '@/lib/supabase/client'
import { formatDate } from '@/lib/utils'

interface TaskInstance {
    id: string
    task_id: string
    scheduled_date: string
    status: string
    completed_at: string | null
    notes: string | null
    tasks: {
        title: string
        description: string | null
        location: string | null
        cutoff_time: string | null
        requires_photo: boolean
        requires_video: boolean
        requires_notes: boolean
    } | null
}

export default function EmployeeTasksPage() {
    const { } = useAuth() // Using auth for context check
    const [tasks, setTasks] = useState<TaskInstance[]>([])
    const [loading, setLoading] = useState(true)
    const [filter, setFilter] = useState<'all' | 'pending' | 'completed'>('all')
    const [selectedTask, setSelectedTask] = useState<TaskInstance | null>(null)

    // Form state for completing task
    const [notes, setNotes] = useState('')
    const [completing, setCompleting] = useState(false)

    const loadTasks = useCallback(async () => {
        setLoading(true)
        try {
            const supabase = createUntypedClient()
            let query = supabase
                .from('task_instances')
                .select(`
          *,
          tasks (
            title,
            description,
            location,
            cutoff_time,
            requires_photo,
            requires_video,
            requires_notes
          )
        `)
                .order('scheduled_date', { ascending: false })
                .limit(50)

            if (filter === 'pending') {
                query = query.eq('status', 'pending')
            } else if (filter === 'completed') {
                query = query.eq('status', 'completed')
            }

            const { data, error } = await query
            if (error) throw error
            setTasks(data || [])
        } catch (err) {
            console.error('Error loading tasks:', err)
        } finally {
            setLoading(false)
        }
    }, [filter])

    useEffect(() => {
        loadTasks()
    }, [loadTasks])

    async function completeTask(taskInstance: TaskInstance) {
        if (taskInstance.tasks?.requires_notes && !notes.trim()) {
            alert('Please add notes before completing this task')
            return
        }

        setCompleting(true)
        try {
            const supabase = createUntypedClient()
            const { error } = await supabase
                .from('task_instances')
                .update({
                    status: 'completed',
                    completed_at: new Date().toISOString(),
                    notes: notes || null,
                })
                .eq('id', taskInstance.id)

            if (error) throw error
            await loadTasks()
            setSelectedTask(null)
            setNotes('')
        } catch (err) {
            console.error('Error completing task:', err)
            alert('Failed to complete task')
        } finally {
            setCompleting(false)
        }
    }

    const pendingCount = tasks.filter((t) => t.status === 'pending').length
    const completedCount = tasks.filter((t) => t.status === 'completed').length

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold">My Tasks</h1>
                    <p className="text-muted-foreground mt-1">
                        View and complete your assigned tasks
                    </p>
                </div>
            </div>

            {/* Summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="card p-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Total Tasks</p>
                            <p className="text-2xl font-bold">{tasks.length}</p>
                        </div>
                        <span className="text-2xl">📋</span>
                    </div>
                </div>
                <div className="card p-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Pending</p>
                            <p className="text-2xl font-bold text-yellow-600">{pendingCount}</p>
                        </div>
                        <span className="text-2xl">⏳</span>
                    </div>
                </div>
                <div className="card p-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Completed</p>
                            <p className="text-2xl font-bold text-green-600">{completedCount}</p>
                        </div>
                        <span className="text-2xl">✅</span>
                    </div>
                </div>
            </div>

            {/* Filter tabs */}
            <div className="flex gap-2 border-b">
                {(['all', 'pending', 'completed'] as const).map((tab) => (
                    <button
                        key={tab}
                        onClick={() => setFilter(tab)}
                        className={`px-4 py-2 font-medium transition-colors border-b-2 -mb-px ${filter === tab
                            ? 'border-primary text-primary'
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </button>
                ))}
            </div>

            {loading ? (
                <div className="space-y-4">
                    {[...Array(5)].map((_, i) => (
                        <div key={i} className="h-24 bg-muted rounded-lg animate-pulse"></div>
                    ))}
                </div>
            ) : tasks.length === 0 ? (
                <div className="card p-8 text-center">
                    <p className="text-muted-foreground">No tasks found</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {tasks.map((task) => (
                        <div
                            key={task.id}
                            className={`card ${task.status !== 'pending' ? 'opacity-60' : ''}`}
                        >
                            <div className="p-4">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="flex items-start gap-3 flex-1">
                                        <span className="text-2xl mt-1">
                                            {task.status === 'completed' ? '✅' : '⬜'}
                                        </span>
                                        <div className="flex-1">
                                            <h3 className={`font-semibold ${task.status === 'completed' ? 'line-through' : ''}`}>
                                                {task.tasks?.title || 'Unknown Task'}
                                            </h3>
                                            {task.tasks?.description && (
                                                <p className="text-sm text-muted-foreground mt-1">
                                                    {task.tasks.description}
                                                </p>
                                            )}
                                            <div className="flex flex-wrap gap-2 mt-2 text-xs text-muted-foreground">
                                                <span>📅 {formatDate(task.scheduled_date)}</span>
                                                {task.tasks?.location && (
                                                    <span>📍 {task.tasks.location}</span>
                                                )}
                                                {task.tasks?.cutoff_time && (
                                                    <span>⏰ Due by {task.tasks.cutoff_time}</span>
                                                )}
                                            </div>
                                            {task.status === 'completed' && task.notes && (
                                                <p className="text-sm text-muted-foreground mt-2 italic">
                                                    Notes: {task.notes}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex flex-col items-end gap-2">
                                        <span className={`badge text-xs ${task.status === 'completed' ? 'badge-success' :
                                            task.status === 'overdue' ? 'badge-destructive' :
                                                'badge-warning'
                                            }`}>
                                            {task.status}
                                        </span>
                                        {task.status === 'pending' && (
                                            <button
                                                onClick={() => setSelectedTask(task)}
                                                className="btn-primary btn-sm"
                                            >
                                                Complete
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Complete Task Modal */}
            {selectedTask && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div
                        className="absolute inset-0 bg-black/50"
                        onClick={() => setSelectedTask(null)}
                    ></div>
                    <div className="relative card w-full max-w-md">
                        <div className="card-header">
                            <h2 className="card-title">Complete Task</h2>
                            <p className="card-description">{selectedTask.tasks?.title}</p>
                        </div>
                        <div className="card-content space-y-4">
                            {selectedTask.tasks?.requires_notes && (
                                <div>
                                    <label className="label mb-2 block">
                                        Notes <span className="text-destructive">*</span>
                                    </label>
                                    <textarea
                                        className="input min-h-[100px]"
                                        value={notes}
                                        onChange={(e) => setNotes(e.target.value)}
                                        placeholder="Add your notes..."
                                        required
                                    />
                                </div>
                            )}
                            {!selectedTask.tasks?.requires_notes && (
                                <div>
                                    <label className="label mb-2 block">Notes (optional)</label>
                                    <textarea
                                        className="input min-h-[80px]"
                                        value={notes}
                                        onChange={(e) => setNotes(e.target.value)}
                                        placeholder="Add optional notes..."
                                    />
                                </div>
                            )}
                            {selectedTask.tasks?.requires_photo && (
                                <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg text-sm text-yellow-800 dark:text-yellow-200">
                                    📷 This task requires a photo (upload feature coming soon)
                                </div>
                            )}
                            {selectedTask.tasks?.requires_video && (
                                <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg text-sm text-yellow-800 dark:text-yellow-200">
                                    🎥 This task requires a video (upload feature coming soon)
                                </div>
                            )}
                        </div>
                        <div className="card-footer gap-3 justify-end">
                            <button
                                onClick={() => {
                                    setSelectedTask(null)
                                    setNotes('')
                                }}
                                className="btn-outline"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => completeTask(selectedTask)}
                                className="btn-primary"
                                disabled={completing}
                            >
                                {completing ? 'Completing...' : 'Mark Complete'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
