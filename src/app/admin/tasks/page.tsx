'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

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

export default function TasksPage() {
    const [tasks, setTasks] = useState<Task[]>([])
    const [loading, setLoading] = useState(true)

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [showModal, setShowModal] = useState(false)

    useEffect(() => {
        loadTasks()
    }, [])

    async function loadTasks() {
        setLoading(true)
        try {
            const supabase = createClient()
            const { data, error } = await supabase
                .from('tasks')
                .select('*')
                .order('title')

            if (error) throw error
            setTasks(data || [])
        } catch (err) {
            console.error('Error loading tasks:', err)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold">Tasks</h1>
                    <p className="text-muted-foreground mt-1">
                        Create and manage task definitions
                    </p>
                </div>
                <button className="btn-primary" onClick={() => setShowModal(true)}>
                    + Create Task
                </button>
            </div>

            {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {[...Array(6)].map((_, i) => (
                        <div key={i} className="h-48 bg-muted rounded-lg animate-pulse"></div>
                    ))}
                </div>
            ) : tasks.length === 0 ? (
                <div className="card p-8 text-center">
                    <p className="text-muted-foreground mb-4">No tasks created yet</p>
                    <button className="btn-primary" onClick={() => setShowModal(true)}>
                        Create Your First Task
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {tasks.map((task) => (
                        <div key={task.id} className="card hover:shadow-md transition-shadow">
                            <div className="p-4">
                                <div className="flex items-start justify-between mb-2">
                                    <h3 className="font-semibold">{task.title}</h3>
                                    {task.is_recurring && (
                                        <span className="badge-default text-xs">🔄 {task.frequency}</span>
                                    )}
                                </div>
                                {task.description && (
                                    <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                                        {task.description}
                                    </p>
                                )}
                                <div className="space-y-1 text-xs text-muted-foreground">
                                    {task.location && (
                                        <p>📍 {task.location}</p>
                                    )}
                                    {task.cutoff_time && (
                                        <p>⏰ Due by {task.cutoff_time}</p>
                                    )}
                                    {task.role_target && (
                                        <p>👤 {task.role_target}</p>
                                    )}
                                </div>
                                <div className="flex gap-2 mt-3">
                                    {task.requires_photo && (
                                        <span className="badge-outline text-xs">📷 Photo</span>
                                    )}
                                    {task.requires_video && (
                                        <span className="badge-outline text-xs">🎥 Video</span>
                                    )}
                                    {task.requires_notes && (
                                        <span className="badge-outline text-xs">📝 Notes</span>
                                    )}
                                </div>
                                <div className="flex gap-2 mt-4 pt-3 border-t">
                                    <button className="btn-ghost btn-sm flex-1">Edit</button>
                                    <button className="btn-ghost btn-sm flex-1">Assign</button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
