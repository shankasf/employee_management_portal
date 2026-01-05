'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { createUntypedClient } from '@/lib/supabase/client'
import { formatDate, getSignedStorageUrl } from '@/lib/utils'

interface TaskInstance {
    id: string
    task_id: string
    scheduled_date: string
    status: string
    completed_at: string | null
    notes: string | null
    photo_url: string | null
    video_url: string | null
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
    const { user } = useAuth()
    const [tasks, setTasks] = useState<TaskInstance[]>([])
    const [loading, setLoading] = useState(true)
    const [filter, setFilter] = useState<'all' | 'pending' | 'completed'>('all')
    const [selectedTask, setSelectedTask] = useState<TaskInstance | null>(null)
    const [viewingTask, setViewingTask] = useState<TaskInstance | null>(null)
    const [editingTask, setEditingTask] = useState<TaskInstance | null>(null)

    // Form state for completing task
    const [notes, setNotes] = useState('')
    const [photoFile, setPhotoFile] = useState<File | null>(null)
    const [videoFile, setVideoFile] = useState<File | null>(null)
    const [photoPreview, setPhotoPreview] = useState<string | null>(null)
    const [videoPreview, setVideoPreview] = useState<string | null>(null)
    const [completing, setCompleting] = useState(false)
    const [uploadProgress, setUploadProgress] = useState<string>('')
    const [signedPhotoUrl, setSignedPhotoUrl] = useState<string | null>(null)
    const [signedVideoUrl, setSignedVideoUrl] = useState<string | null>(null)
    const [editSignedPhotoUrl, setEditSignedPhotoUrl] = useState<string | null>(null)
    const [editSignedVideoUrl, setEditSignedVideoUrl] = useState<string | null>(null)

    const photoInputRef = useRef<HTMLInputElement>(null)
    const videoInputRef = useRef<HTMLInputElement>(null)

    const loadTasks = useCallback(async () => {
        if (!user?.id) {
            setLoading(false)
            return
        }
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
                .eq('employee_id', user.id)
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
    }, [filter, user?.id])

    useEffect(() => {
        loadTasks()
    }, [loadTasks])

    // Handle photo file selection
    function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        if (file) {
            if (!file.type.startsWith('image/')) {
                alert('Please select an image file')
                return
            }
            if (file.size > 10 * 1024 * 1024) { // 10MB limit
                alert('Image must be less than 10MB')
                return
            }
            setPhotoFile(file)
            setPhotoPreview(URL.createObjectURL(file))
        }
    }

    // Handle video file selection
    function handleVideoChange(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        if (file) {
            if (!file.type.startsWith('video/')) {
                alert('Please select a video file')
                return
            }
            if (file.size > 100 * 1024 * 1024) { // 100MB limit
                alert('Video must be less than 100MB')
                return
            }
            setVideoFile(file)
            setVideoPreview(URL.createObjectURL(file))
        }
    }

    // Upload file to Supabase storage
    async function uploadFile(file: File, type: 'photo' | 'video', taskId: string): Promise<string | null> {
        const supabase = createUntypedClient()
        const fileExt = file.name.split('.').pop()
        const fileName = `${taskId}_${type}_${Date.now()}.${fileExt}`
        // Path structure: user_id/filename (to match storage policy)
        const filePath = `${user?.id}/${fileName}`

        setUploadProgress(`Uploading ${type}...`)

        const { error: uploadError } = await supabase.storage
            .from('task-media')
            .upload(filePath, file, {
                cacheControl: '3600',
                upsert: false
            })

        if (uploadError) {
            console.error(`Error uploading ${type}:`, uploadError)
            // If bucket doesn't exist, try to continue without upload
            if (uploadError.message?.includes('Bucket not found')) {
                console.warn('Storage bucket not configured - skipping upload')
                return null
            }
            throw uploadError
        }

        // Return the file path instead of public URL since bucket is private
        // We'll generate signed URLs when displaying
        return filePath
    }

    function resetForm() {
        setNotes('')
        setPhotoFile(null)
        setVideoFile(null)
        setPhotoPreview(null)
        setVideoPreview(null)
        setUploadProgress('')
    }

    // Generate signed URLs when viewing a task
    useEffect(() => {
        async function loadSignedUrls() {
            if (viewingTask) {
                const photoUrl = await getSignedStorageUrl(viewingTask.photo_url)
                const videoUrl = await getSignedStorageUrl(viewingTask.video_url)
                setSignedPhotoUrl(photoUrl)
                setSignedVideoUrl(videoUrl)
            } else {
                setSignedPhotoUrl(null)
                setSignedVideoUrl(null)
            }
        }
        loadSignedUrls()
    }, [viewingTask])

    // Open edit modal with current values
    async function openEditModal(task: TaskInstance) {
        setEditingTask(task)
        setNotes(task.notes || '')
        // Generate signed URLs for existing media
        const photoUrl = await getSignedStorageUrl(task.photo_url)
        const videoUrl = await getSignedStorageUrl(task.video_url)
        setEditSignedPhotoUrl(photoUrl)
        setEditSignedVideoUrl(videoUrl)
        setPhotoPreview(photoUrl)
        setVideoPreview(videoUrl)
        setViewingTask(null)
    }

    // Update completed task submission
    async function updateSubmission(taskInstance: TaskInstance) {
        if (taskInstance.tasks?.requires_notes && !notes.trim()) {
            alert('Notes are required for this task')
            return
        }

        setCompleting(true)
        try {
            let photoUrl: string | null = taskInstance.photo_url
            let videoUrl: string | null = taskInstance.video_url

            // Upload new photo if provided
            if (photoFile) {
                try {
                    const newPhotoUrl = await uploadFile(photoFile, 'photo', taskInstance.id)
                    if (newPhotoUrl) photoUrl = newPhotoUrl
                } catch (err) {
                    console.warn('Photo upload failed:', err)
                }
            }

            // Upload new video if provided
            if (videoFile) {
                try {
                    const newVideoUrl = await uploadFile(videoFile, 'video', taskInstance.id)
                    if (newVideoUrl) videoUrl = newVideoUrl
                } catch (err) {
                    console.warn('Video upload failed:', err)
                }
            }

            setUploadProgress('Saving changes...')

            const supabase = createUntypedClient()
            const { error } = await supabase
                .from('task_instances')
                .update({
                    notes: notes || null,
                    photo_url: photoUrl,
                    video_url: videoUrl,
                })
                .eq('id', taskInstance.id)

            if (error) throw error
            await loadTasks()
            setEditingTask(null)
            resetForm()
            alert('Submission updated successfully!')
        } catch (err) {
            console.error('Error updating submission:', err)
            alert('Failed to update submission')
        } finally {
            setCompleting(false)
            setUploadProgress('')
        }
    }

    async function completeTask(taskInstance: TaskInstance) {
        if (taskInstance.tasks?.requires_notes && !notes.trim()) {
            alert('Please add notes before completing this task')
            return
        }

        if (taskInstance.tasks?.requires_photo && !photoFile) {
            alert('Please upload a photo before completing this task')
            return
        }

        if (taskInstance.tasks?.requires_video && !videoFile) {
            alert('Please upload a video before completing this task')
            return
        }

        setCompleting(true)
        try {
            let photoUrl: string | null = null
            let videoUrl: string | null = null

            // Upload photo if provided
            if (photoFile) {
                try {
                    photoUrl = await uploadFile(photoFile, 'photo', taskInstance.id)
                } catch (err) {
                    console.warn('Photo upload failed, continuing without photo:', err)
                }
            }

            // Upload video if provided
            if (videoFile) {
                try {
                    videoUrl = await uploadFile(videoFile, 'video', taskInstance.id)
                } catch (err) {
                    console.warn('Video upload failed, continuing without video:', err)
                }
            }

            setUploadProgress('Saving task...')

            const supabase = createUntypedClient()
            const { error } = await supabase
                .from('task_instances')
                .update({
                    status: 'completed',
                    completed_at: new Date().toISOString(),
                    notes: notes || null,
                    photo_url: photoUrl,
                    video_url: videoUrl,
                })
                .eq('id', taskInstance.id)

            if (error) throw error
            await loadTasks()
            setSelectedTask(null)
            resetForm()
            alert('Task completed successfully!')
        } catch (err) {
            console.error('Error completing task:', err)
            alert('Failed to complete task')
        } finally {
            setCompleting(false)
            setUploadProgress('')
        }
    }

    const pendingCount = tasks.filter((t) => t.status === 'pending').length
    const completedCount = tasks.filter((t) => t.status === 'completed').length

    return (
        <div className="space-y-4 sm:space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold">My Tasks</h1>
                    <p className="text-muted-foreground mt-1 text-sm sm:text-base">
                        View and complete your assigned tasks
                    </p>
                </div>
            </div>

            {/* Summary */}
            <div className="grid grid-cols-3 gap-2 sm:gap-4">
                <div className="card p-3 sm:p-4">
                    <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                            <p className="text-xs sm:text-sm text-muted-foreground truncate">Total</p>
                            <p className="text-lg sm:text-2xl font-bold">{tasks.length}</p>
                        </div>
                        <span className="text-lg sm:text-2xl flex-shrink-0">📋</span>
                    </div>
                </div>
                <div className="card p-3 sm:p-4">
                    <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                            <p className="text-xs sm:text-sm text-muted-foreground truncate">Pending</p>
                            <p className="text-lg sm:text-2xl font-bold text-yellow-600">{pendingCount}</p>
                        </div>
                        <span className="text-lg sm:text-2xl flex-shrink-0">⏳</span>
                    </div>
                </div>
                <div className="card p-3 sm:p-4">
                    <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                            <p className="text-xs sm:text-sm text-muted-foreground truncate">Completed</p>
                            <p className="text-lg sm:text-2xl font-bold text-green-600">{completedCount}</p>
                        </div>
                        <span className="text-lg sm:text-2xl flex-shrink-0">✅</span>
                    </div>
                </div>
            </div>

            {/* Filter tabs */}
            <div className="flex gap-1 sm:gap-2 border-b overflow-x-auto scrollbar-hide -mx-3 px-3 sm:mx-0 sm:px-0">
                {(['all', 'pending', 'completed'] as const).map((tab) => (
                    <button
                        key={tab}
                        onClick={() => setFilter(tab)}
                        className={`px-3 sm:px-4 py-2 font-medium transition-colors border-b-2 -mb-px text-sm whitespace-nowrap ${filter === tab
                            ? 'border-primary text-primary'
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </button>
                ))}
            </div>

            {loading ? (
                <div className="space-y-3 sm:space-y-4">
                    {[...Array(5)].map((_, i) => (
                        <div key={i} className="h-20 sm:h-24 bg-muted rounded-lg animate-pulse"></div>
                    ))}
                </div>
            ) : tasks.length === 0 ? (
                <div className="card p-6 sm:p-8 text-center">
                    <p className="text-muted-foreground text-sm sm:text-base">No tasks found</p>
                </div>
            ) : (
                <div className="space-y-3 sm:space-y-4">
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
                                        {task.status === 'completed' && (
                                            <button
                                                onClick={() => setViewingTask(task)}
                                                className="btn-outline btn-sm"
                                            >
                                                View Details
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

                            {/* Photo Upload */}
                            <div>
                                <label className="label mb-2 block">
                                    📷 Photo {selectedTask.tasks?.requires_photo && <span className="text-destructive">*</span>}
                                    {!selectedTask.tasks?.requires_photo && <span className="text-muted-foreground">(optional)</span>}
                                </label>
                                <input
                                    ref={photoInputRef}
                                    type="file"
                                    accept="image/*"
                                    capture="environment"
                                    onChange={handlePhotoChange}
                                    className="hidden"
                                />
                                {photoPreview ? (
                                    <div className="relative">
                                        <img
                                            src={photoPreview}
                                            alt="Photo preview"
                                            className="w-full h-40 object-cover rounded-lg border"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setPhotoFile(null)
                                                setPhotoPreview(null)
                                                if (photoInputRef.current) photoInputRef.current.value = ''
                                            }}
                                            className="absolute top-2 right-2 bg-destructive text-white rounded-full w-6 h-6 flex items-center justify-center text-sm"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => photoInputRef.current?.click()}
                                        className="w-full h-24 border-2 border-dashed border-muted-foreground/25 rounded-lg hover:border-primary/50 transition-colors flex flex-col items-center justify-center gap-2 text-muted-foreground"
                                    >
                                        <span className="text-2xl">📷</span>
                                        <span className="text-sm">Click to upload photo</span>
                                    </button>
                                )}
                            </div>

                            {/* Video Upload */}
                            <div>
                                <label className="label mb-2 block">
                                    🎥 Video {selectedTask.tasks?.requires_video && <span className="text-destructive">*</span>}
                                    {!selectedTask.tasks?.requires_video && <span className="text-muted-foreground">(optional)</span>}
                                </label>
                                <input
                                    ref={videoInputRef}
                                    type="file"
                                    accept="video/*"
                                    capture="environment"
                                    onChange={handleVideoChange}
                                    className="hidden"
                                />
                                {videoPreview ? (
                                    <div className="relative">
                                        <video
                                            src={videoPreview}
                                            className="w-full h-40 object-cover rounded-lg border"
                                            controls
                                        />
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setVideoFile(null)
                                                setVideoPreview(null)
                                                if (videoInputRef.current) videoInputRef.current.value = ''
                                            }}
                                            className="absolute top-2 right-2 bg-destructive text-white rounded-full w-6 h-6 flex items-center justify-center text-sm"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => videoInputRef.current?.click()}
                                        className="w-full h-24 border-2 border-dashed border-muted-foreground/25 rounded-lg hover:border-primary/50 transition-colors flex flex-col items-center justify-center gap-2 text-muted-foreground"
                                    >
                                        <span className="text-2xl">🎥</span>
                                        <span className="text-sm">Click to upload video</span>
                                    </button>
                                )}
                            </div>

                            {uploadProgress && (
                                <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-sm text-blue-800 dark:text-blue-200 text-center">
                                    ⏳ {uploadProgress}
                                </div>
                            )}
                        </div>
                        <div className="card-footer gap-3 justify-end">
                            <button
                                onClick={() => {
                                    setSelectedTask(null)
                                    resetForm()
                                }}
                                className="btn-outline"
                                disabled={completing}
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

            {/* View Submission Modal */}
            {viewingTask && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div
                        className="absolute inset-0 bg-black/50"
                        onClick={() => setViewingTask(null)}
                    ></div>
                    <div className="relative card w-full max-w-lg max-h-[90vh] overflow-y-auto">
                        <div className="card-header">
                            <h2 className="card-title">Task Submission</h2>
                            <p className="card-description">{viewingTask.tasks?.title}</p>
                        </div>
                        <div className="card-content space-y-4">
                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                    <p className="text-muted-foreground">Scheduled Date</p>
                                    <p className="font-medium">{formatDate(viewingTask.scheduled_date)}</p>
                                </div>
                                <div>
                                    <p className="text-muted-foreground">Completed At</p>
                                    <p className="font-medium">
                                        {viewingTask.completed_at
                                            ? new Date(viewingTask.completed_at).toLocaleString()
                                            : 'N/A'}
                                    </p>
                                </div>
                            </div>

                            {viewingTask.notes && (
                                <div>
                                    <p className="text-sm text-muted-foreground mb-1">📝 Notes</p>
                                    <p className="text-sm bg-muted p-3 rounded-lg">{viewingTask.notes}</p>
                                </div>
                            )}

                            {viewingTask.photo_url && (
                                <div>
                                    <p className="text-sm text-muted-foreground mb-2">📷 Photo</p>
                                    {signedPhotoUrl ? (
                                        <>
                                            <a
                                                href={signedPhotoUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="block"
                                            >
                                                <img
                                                    src={signedPhotoUrl}
                                                    alt="Task photo"
                                                    className="w-full max-h-64 object-contain rounded-lg border cursor-pointer hover:opacity-80 transition-opacity"
                                                />
                                            </a>
                                            <p className="text-xs text-muted-foreground mt-1">Click to open full size</p>
                                        </>
                                    ) : (
                                        <p className="text-sm text-muted-foreground">Loading photo...</p>
                                    )}
                                </div>
                            )}

                            {viewingTask.video_url && (
                                <div>
                                    <p className="text-sm text-muted-foreground mb-2">🎥 Video</p>
                                    {signedVideoUrl ? (
                                        <video
                                            src={signedVideoUrl}
                                            className="w-full max-h-64 rounded-lg border"
                                            controls
                                        />
                                    ) : (
                                        <p className="text-sm text-muted-foreground">Loading video...</p>
                                    )}
                                </div>
                            )}

                            {!viewingTask.notes && !viewingTask.photo_url && !viewingTask.video_url && (
                                <p className="text-sm text-muted-foreground italic">
                                    No additional submission details
                                </p>
                            )}
                        </div>
                        <div className="card-footer gap-3 justify-end">
                            <button
                                onClick={() => setViewingTask(null)}
                                className="btn-outline"
                            >
                                Close
                            </button>
                            <button
                                onClick={() => openEditModal(viewingTask)}
                                className="btn-primary"
                            >
                                ✏️ Edit Submission
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit Submission Modal */}
            {editingTask && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div
                        className="absolute inset-0 bg-black/50"
                        onClick={() => {
                            setEditingTask(null)
                            resetForm()
                        }}
                    ></div>
                    <div className="relative card w-full max-w-md max-h-[90vh] overflow-y-auto">
                        <div className="card-header">
                            <h2 className="card-title">Edit Submission</h2>
                            <p className="card-description">{editingTask.tasks?.title}</p>
                        </div>
                        <div className="card-content space-y-4">
                            {/* Notes */}
                            <div>
                                <label className="label mb-2 block">
                                    📝 Notes {editingTask.tasks?.requires_notes && <span className="text-destructive">*</span>}
                                </label>
                                <textarea
                                    className="input min-h-[100px]"
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    placeholder="Add your notes..."
                                />
                            </div>

                            {/* Photo Upload/Replace */}
                            <div>
                                <label className="label mb-2 block">
                                    📷 Photo {editingTask.tasks?.requires_photo && <span className="text-destructive">*</span>}
                                </label>
                                <input
                                    ref={photoInputRef}
                                    type="file"
                                    accept="image/*"
                                    capture="environment"
                                    onChange={handlePhotoChange}
                                    className="hidden"
                                />
                                {(photoPreview || photoFile || editSignedPhotoUrl) ? (
                                    <div className="relative">
                                        <img
                                            src={photoFile ? URL.createObjectURL(photoFile) : (photoPreview || editSignedPhotoUrl || '')}
                                            alt="Photo preview"
                                            className="w-full h-40 object-cover rounded-lg border"
                                        />
                                        <div className="absolute top-2 right-2 flex gap-1">
                                            <button
                                                type="button"
                                                onClick={() => photoInputRef.current?.click()}
                                                className="bg-primary text-white rounded-full w-6 h-6 flex items-center justify-center text-sm"
                                                title="Replace photo"
                                            >
                                                🔄
                                            </button>
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            {photoFile ? '📌 New photo selected' : '📁 Current photo'}
                                        </p>
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => photoInputRef.current?.click()}
                                        className="w-full h-24 border-2 border-dashed border-muted-foreground/25 rounded-lg hover:border-primary/50 transition-colors flex flex-col items-center justify-center gap-2 text-muted-foreground"
                                    >
                                        <span className="text-2xl">📷</span>
                                        <span className="text-sm">Click to upload photo</span>
                                    </button>
                                )}
                            </div>

                            {/* Video Upload/Replace */}
                            <div>
                                <label className="label mb-2 block">
                                    🎥 Video {editingTask.tasks?.requires_video && <span className="text-destructive">*</span>}
                                </label>
                                <input
                                    ref={videoInputRef}
                                    type="file"
                                    accept="video/*"
                                    capture="environment"
                                    onChange={handleVideoChange}
                                    className="hidden"
                                />
                                {(videoPreview || videoFile || editSignedVideoUrl) ? (
                                    <div className="relative">
                                        <video
                                            src={videoFile ? URL.createObjectURL(videoFile) : (videoPreview || editSignedVideoUrl || '')}
                                            className="w-full h-40 object-cover rounded-lg border"
                                            controls
                                        />
                                        <div className="absolute top-2 right-2 flex gap-1">
                                            <button
                                                type="button"
                                                onClick={() => videoInputRef.current?.click()}
                                                className="bg-primary text-white rounded-full w-6 h-6 flex items-center justify-center text-sm"
                                                title="Replace video"
                                            >
                                                🔄
                                            </button>
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            {videoFile ? '📌 New video selected' : '📁 Current video'}
                                        </p>
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => videoInputRef.current?.click()}
                                        className="w-full h-24 border-2 border-dashed border-muted-foreground/25 rounded-lg hover:border-primary/50 transition-colors flex flex-col items-center justify-center gap-2 text-muted-foreground"
                                    >
                                        <span className="text-2xl">🎥</span>
                                        <span className="text-sm">Click to upload video</span>
                                    </button>
                                )}
                            </div>

                            {uploadProgress && (
                                <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-sm text-blue-800 dark:text-blue-200 text-center">
                                    ⏳ {uploadProgress}
                                </div>
                            )}
                        </div>
                        <div className="card-footer gap-3 justify-end">
                            <button
                                onClick={() => {
                                    setEditingTask(null)
                                    resetForm()
                                }}
                                className="btn-outline"
                                disabled={completing}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => updateSubmission(editingTask)}
                                className="btn-primary"
                                disabled={completing}
                            >
                                {completing ? 'Saving...' : 'Save Changes'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
