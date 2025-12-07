'use client'

import { useState } from 'react'
import { createUntypedClient } from '@/lib/supabase/client'
import { formatDate, formatDateTime } from '@/lib/utils'

// Using 'any' type for Supabase joined data
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TaskCompletion = any

export default function ReportsPage() {
    const [selectedReport, setSelectedReport] = useState<string | null>(null)
    const [startDate, setStartDate] = useState(() => {
        const d = new Date()
        d.setDate(d.getDate() - 1)
        return d.toISOString().split('T')[0]
    })
    const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0])
    const [loading, setLoading] = useState(false)
    const [taskCompletions, setTaskCompletions] = useState<TaskCompletion[]>([])
    const [selectedCompletion, setSelectedCompletion] = useState<TaskCompletion | null>(null)

    const reportTypes = [
        {
            id: 'attendance',
            title: 'Attendance Report',
            description: 'View attendance patterns, hours worked, and punctuality',
            icon: '⏰',
        },
        {
            id: 'tasks',
            title: 'Task Completion Report',
            description: 'Track task completion rates and performance',
            icon: '✅',
        },
        {
            id: 'events',
            title: 'Events Report',
            description: 'Review events, staffing, and checklist completion',
            icon: '🎉',
        },
        {
            id: 'employee',
            title: 'Employee Performance',
            description: 'Individual employee metrics and statistics',
            icon: '📊',
        },
    ]

    async function generateTaskReport() {
        setLoading(true)
        try {
            const supabase = createUntypedClient()
            const { data, error } = await supabase
                .from('task_instances')
                .select(`
                    id,
                    scheduled_date,
                    status,
                    completed_at,
                    notes,
                    photo_url,
                    video_url,
                    tasks (
                        title,
                        description,
                        location
                    ),
                    employees (
                        id,
                        display_name
                    )
                `)
                .gte('scheduled_date', startDate)
                .lte('scheduled_date', endDate)
                .order('scheduled_date', { ascending: false })
                .limit(100)

            if (error) throw error
            setTaskCompletions(data || [])
        } catch (err) {
            console.error('Error generating report:', err)
            alert('Failed to generate report')
        } finally {
            setLoading(false)
        }
    }

    function handleGenerateReport() {
        if (selectedReport === 'tasks') {
            generateTaskReport()
        }
    }

    const completedCount = taskCompletions.filter(t => t.status === 'completed').length
    const pendingCount = taskCompletions.filter(t => t.status === 'pending').length
    const overdueCount = taskCompletions.filter(t => t.status === 'overdue').length

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold">Reports</h1>
                <p className="text-muted-foreground mt-1">
                    Generate and view detailed reports
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {reportTypes.map((report) => (
                    <button
                        key={report.id}
                        onClick={() => setSelectedReport(report.id)}
                        className={`card p-6 text-left hover:shadow-md transition-all ${selectedReport === report.id ? 'ring-2 ring-primary' : ''
                            }`}
                    >
                        <div className="flex items-start gap-4">
                            <span className="text-3xl">{report.icon}</span>
                            <div>
                                <h3 className="font-semibold">{report.title}</h3>
                                <p className="text-sm text-muted-foreground mt-1">
                                    {report.description}
                                </p>
                            </div>
                        </div>
                    </button>
                ))}
            </div>

            {selectedReport && (
                <div className="card">
                    <div className="card-header">
                        <h2 className="card-title text-lg">
                            {reportTypes.find((r) => r.id === selectedReport)?.title}
                        </h2>
                    </div>
                    <div className="card-content">
                        <div className="flex flex-col sm:flex-row gap-4 mb-6">
                            <div className="flex-1">
                                <label className="label mb-2 block">Start Date</label>
                                <input
                                    type="date"
                                    className="input"
                                    value={startDate}
                                    onChange={(e) => setStartDate(e.target.value)}
                                />
                            </div>
                            <div className="flex-1">
                                <label className="label mb-2 block">End Date</label>
                                <input
                                    type="date"
                                    className="input"
                                    value={endDate}
                                    onChange={(e) => setEndDate(e.target.value)}
                                />
                            </div>
                            <div className="flex items-end">
                                <button
                                    className="btn-primary"
                                    onClick={handleGenerateReport}
                                    disabled={loading}
                                >
                                    {loading ? 'Loading...' : 'Generate Report'}
                                </button>
                            </div>
                        </div>

                        {selectedReport === 'tasks' && taskCompletions.length > 0 && (
                            <>
                                {/* Summary Stats */}
                                <div className="grid grid-cols-3 gap-4 mb-6">
                                    <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg text-center">
                                        <p className="text-2xl font-bold text-green-600">{completedCount}</p>
                                        <p className="text-sm text-green-700 dark:text-green-400">Completed</p>
                                    </div>
                                    <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg text-center">
                                        <p className="text-2xl font-bold text-yellow-600">{pendingCount}</p>
                                        <p className="text-sm text-yellow-700 dark:text-yellow-400">Pending</p>
                                    </div>
                                    <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg text-center">
                                        <p className="text-2xl font-bold text-red-600">{overdueCount}</p>
                                        <p className="text-sm text-red-700 dark:text-red-400">Overdue</p>
                                    </div>
                                </div>

                                {/* Task List */}
                                <div className="border rounded-lg overflow-hidden">
                                    <table className="w-full">
                                        <thead className="bg-muted">
                                            <tr>
                                                <th className="px-4 py-3 text-left text-sm font-medium">Task</th>
                                                <th className="px-4 py-3 text-left text-sm font-medium">Employee</th>
                                                <th className="px-4 py-3 text-left text-sm font-medium">Date</th>
                                                <th className="px-4 py-3 text-left text-sm font-medium">Status</th>
                                                <th className="px-4 py-3 text-left text-sm font-medium">Attachments</th>
                                                <th className="px-4 py-3 text-left text-sm font-medium">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y">
                                            {taskCompletions.map((task) => (
                                                <tr key={task.id} className="hover:bg-muted/50">
                                                    <td className="px-4 py-3">
                                                        <p className="font-medium">{task.tasks?.title || 'Unknown'}</p>
                                                        {task.tasks?.location && (
                                                            <p className="text-xs text-muted-foreground">📍 {task.tasks.location}</p>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3 text-sm">
                                                        {task.employees?.display_name || 'Unassigned'}
                                                    </td>
                                                    <td className="px-4 py-3 text-sm">
                                                        {formatDate(task.scheduled_date)}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <span className={`badge text-xs ${task.status === 'completed' ? 'badge-success' :
                                                            task.status === 'overdue' ? 'badge-destructive' :
                                                                'badge-warning'
                                                            }`}>
                                                            {task.status}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <div className="flex gap-1">
                                                            {task.notes && <span title="Has notes">📝</span>}
                                                            {task.photo_url && <span title="Has photo">📷</span>}
                                                            {task.video_url && <span title="Has video">🎥</span>}
                                                            {!task.notes && !task.photo_url && !task.video_url && (
                                                                <span className="text-muted-foreground text-xs">-</span>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <button
                                                            className="btn-ghost btn-sm"
                                                            onClick={() => setSelectedCompletion(task)}
                                                        >
                                                            View
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </>
                        )}

                        {selectedReport === 'tasks' && taskCompletions.length === 0 && !loading && (
                            <div className="p-8 text-center border-2 border-dashed rounded-lg">
                                <p className="text-muted-foreground">
                                    Select date range and click &quot;Generate Report&quot; to view data
                                </p>
                            </div>
                        )}

                        {selectedReport !== 'tasks' && (
                            <div className="p-8 text-center border-2 border-dashed rounded-lg">
                                <p className="text-muted-foreground">
                                    This report type is coming soon
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Task Detail Modal */}
            {selectedCompletion && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-card rounded-lg shadow-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                        <div className="p-6">
                            <div className="flex items-start justify-between mb-4">
                                <div>
                                    <h2 className="text-xl font-bold">{selectedCompletion.tasks?.title}</h2>
                                    <p className="text-muted-foreground">
                                        {selectedCompletion.employees?.display_name || 'Unassigned'} • {formatDate(selectedCompletion.scheduled_date)}
                                    </p>
                                </div>
                                <button
                                    onClick={() => setSelectedCompletion(null)}
                                    className="text-muted-foreground hover:text-foreground text-xl"
                                >
                                    ✕
                                </button>
                            </div>

                            <div className="space-y-4">
                                {/* Status */}
                                <div className="flex items-center gap-2">
                                    <span className="font-medium">Status:</span>
                                    <span className={`badge ${selectedCompletion.status === 'completed' ? 'badge-success' :
                                        selectedCompletion.status === 'overdue' ? 'badge-destructive' :
                                            'badge-warning'
                                        }`}>
                                        {selectedCompletion.status}
                                    </span>
                                    {selectedCompletion.completed_at && (
                                        <span className="text-sm text-muted-foreground">
                                            (Completed {formatDateTime(selectedCompletion.completed_at)})
                                        </span>
                                    )}
                                </div>

                                {/* Description */}
                                {selectedCompletion.tasks?.description && (
                                    <div>
                                        <p className="font-medium mb-1">Description:</p>
                                        <p className="text-muted-foreground bg-muted p-3 rounded">
                                            {selectedCompletion.tasks.description}
                                        </p>
                                    </div>
                                )}

                                {/* Location */}
                                {selectedCompletion.tasks?.location && (
                                    <div>
                                        <p className="font-medium mb-1">Location:</p>
                                        <p className="text-muted-foreground">📍 {selectedCompletion.tasks.location}</p>
                                    </div>
                                )}

                                {/* Notes */}
                                {selectedCompletion.notes && (
                                    <div>
                                        <p className="font-medium mb-1">📝 Employee Notes:</p>
                                        <p className="bg-muted p-3 rounded">{selectedCompletion.notes}</p>
                                    </div>
                                )}

                                {/* Photo */}
                                {selectedCompletion.photo_url && (
                                    <div>
                                        <p className="font-medium mb-2">📷 Photo Submission:</p>
                                        <img
                                            src={selectedCompletion.photo_url}
                                            alt="Task completion photo"
                                            className="max-w-full h-auto rounded-lg border max-h-96 object-contain"
                                        />
                                    </div>
                                )}

                                {/* Video */}
                                {selectedCompletion.video_url && (
                                    <div>
                                        <p className="font-medium mb-2">🎥 Video Submission:</p>
                                        <video
                                            src={selectedCompletion.video_url}
                                            controls
                                            className="max-w-full h-auto rounded-lg border max-h-96"
                                        />
                                    </div>
                                )}

                                {/* No submissions */}
                                {!selectedCompletion.notes && !selectedCompletion.photo_url && !selectedCompletion.video_url && selectedCompletion.status === 'completed' && (
                                    <div className="p-4 bg-muted rounded-lg text-center text-muted-foreground">
                                        No notes or media were submitted for this task
                                    </div>
                                )}

                                {selectedCompletion.status !== 'completed' && (
                                    <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg text-center text-yellow-800 dark:text-yellow-200">
                                        This task has not been completed yet
                                    </div>
                                )}
                            </div>

                            <div className="mt-6 flex justify-end">
                                <button
                                    onClick={() => setSelectedCompletion(null)}
                                    className="btn-secondary"
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
