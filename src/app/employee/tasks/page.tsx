'use client'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { createUntypedClient } from '@/lib/supabase/client'
import { formatDateOnly, formatDateTime, formatTimeString, getSignedStorageUrl } from '@/lib/utils'
import { RichTextDisplay } from '@/components/RichTextEditor'
import { VideoPlayer } from '@/components/VideoPlayer'
import { taskNotifications } from '@/lib/notifications'
import { logValidationRejection, startUpload } from '@/lib/upload-logger'
import { resumableUpload, shouldUseTus } from '@/lib/resumable-upload'
import { logClientActivity } from '@/lib/client-activity-log'

interface TaskInstance {
    id: string
    task_id: string
    scheduled_date: string
    status: string
    completed_at: string | null
    notes: string | null
    photo_url: string | null
    photo_urls: string[] | null
    video_url: string | null
    video_urls: string[] | null
    tasks: {
        title: string
        description: string | null
        location: string | null
        cutoff_time: string | null
        requires_photo: boolean
        requires_video: boolean
        requires_notes: boolean
        reference_images: string[] | null
        reference_videos: string[] | null
        is_recurring: boolean
        frequency: string | null
        recurrence_days: string[] | null
    } | null
}

interface Filters {
    status: 'all' | 'pending' | 'completed'
    search: string
    location: string
    dateFrom: string
    dateTo: string
    hasPhoto: 'all' | 'yes' | 'no'
    hasVideo: 'all' | 'yes' | 'no'
    hasNotes: 'all' | 'yes' | 'no'
}

export default function EmployeeTasksPage() {
    const { user } = useAuth()
    const [tasks, setTasks] = useState<TaskInstance[]>([])
    const [loading, setLoading] = useState(true)
    const [filters, setFilters] = useState<Filters>({
        status: 'all',
        search: '',
        location: '',
        dateFrom: '',
        dateTo: '',
        hasPhoto: 'all',
        hasVideo: 'all',
        hasNotes: 'all',
    })
    const [showFilters, setShowFilters] = useState(false)
    const [selectedTask, setSelectedTask] = useState<TaskInstance | null>(null)
    const [viewingTask, setViewingTask] = useState<TaskInstance | null>(null)
    const [editingTask, setEditingTask] = useState<TaskInstance | null>(null)

    // Form state for completing task
    const [notes, setNotes] = useState('')
    const [photoFiles, setPhotoFiles] = useState<File[]>([])
    const [videoFiles, setVideoFiles] = useState<File[]>([])
    const [photoPreviews, setPhotoPreviews] = useState<string[]>([])
    const [videoPreviews, setVideoPreviews] = useState<string[]>([])
    const [completing, setCompleting] = useState(false)
    const [uploadProgress, setUploadProgress] = useState<string>('')
    const [uploadPercent, setUploadPercent] = useState<number>(0)
    const [signedPhotoUrls, setSignedPhotoUrls] = useState<string[]>([])
    const [signedVideoUrls, setSignedVideoUrls] = useState<string[]>([])
    const [signedRefImageUrls, setSignedRefImageUrls] = useState<string[]>([])
    const [signedRefVideoUrls, setSignedRefVideoUrls] = useState<string[]>([])
    const [fullscreenVideoUrl, setFullscreenVideoUrl] = useState<string | null>(null)
    const [selectedRefImageUrls, setSelectedRefImageUrls] = useState<string[]>([])
    const [editSignedPhotoUrls, setEditSignedPhotoUrls] = useState<string[]>([])
    const [editSignedVideoUrls, setEditSignedVideoUrls] = useState<string[]>([])
    const [existingPhotoUrls, setExistingPhotoUrls] = useState<string[]>([])
    const [existingVideoUrls, setExistingVideoUrls] = useState<string[]>([])

    const uploadAbortRef = useRef<(() => void) | null>(null)
    const photoInputRef = useRef<HTMLInputElement>(null)
    const videoInputRef = useRef<HTMLInputElement>(null)
    const videoRecordRef = useRef<HTMLInputElement>(null)
    const photoPreviewsRef = useRef<string[]>([])
    const videoPreviewsRef = useRef<string[]>([])

    // Keep refs in sync with state for unmount cleanup
    photoPreviewsRef.current = photoPreviews
    videoPreviewsRef.current = videoPreviews

    // Cleanup Object URLs on unmount to prevent memory leaks
    useEffect(() => {
        return () => {
            photoPreviewsRef.current.forEach(url => URL.revokeObjectURL(url))
            videoPreviewsRef.current.forEach(url => URL.revokeObjectURL(url))
        }
    }, [])

    const loadTasks = useCallback(async () => {
        if (!user?.id) {
            setLoading(false)
            return
        }
        setLoading(true)
        try {
            const supabase = createUntypedClient()
            const query = supabase
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
            requires_notes,
            reference_images,
            reference_videos,
            is_recurring,
            frequency,
            recurrence_days
          )
        `)
                .eq('employee_id', user.id)
                .order('scheduled_date', { ascending: false })
                .limit(100)

            const { data, error } = await query
            if (error) throw error
            setTasks(data || [])
            logClientActivity({
                action: 'tasks_loaded',
                entityType: 'task_instance',
                details: {
                    count: data?.length ?? 0,
                    statuses: {
                        pending: (data || []).filter((t: TaskInstance) => t.status === 'pending').length,
                        completed: (data || []).filter((t: TaskInstance) => t.status === 'completed').length,
                    },
                },
            })
        } catch (err) {
            console.error('Error loading tasks:', err)
            logClientActivity({
                action: 'tasks_load_failed',
                entityType: 'task_instance',
                details: {
                    error: String(err),
                },
            })
        } finally {
            setLoading(false)
        }
    }, [user?.id])

    useEffect(() => {
        loadTasks()
    }, [loadTasks])

    // Re-fetch tasks when window regains focus (e.g. employee switches back to the app)
    useEffect(() => {
        function onFocus() {
            loadTasks()
        }
        window.addEventListener('focus', onFocus)
        return () => window.removeEventListener('focus', onFocus)
    }, [loadTasks])

    // Auto-open a specific task when arriving via SMS deep link (?taskId=...).
    // Runs once tasks have loaded; consumes the param so a refresh doesn't re-open.
    useEffect(() => {
        if (loading || tasks.length === 0) return
        const params = new URLSearchParams(window.location.search)
        const targetId = params.get('taskId')
        if (!targetId) return
        const match = tasks.find(t => t.id === targetId)
        if (match) setViewingTask(match)
        params.delete('taskId')
        const newSearch = params.toString()
        const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : '') + window.location.hash
        window.history.replaceState({}, '', newUrl)
    }, [loading, tasks])

    // Handle photo file selection (multiple)
    function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
        const files = e.target.files
        if (files && files.length > 0) {
            const newFiles: File[] = []
            const newPreviews: string[] = []

            for (let i = 0; i < files.length; i++) {
                const file = files[i]
                if (!file.type.startsWith('image/')) {
                    logValidationRejection(file, 'Not an image file', 'employee_task_photo', 'task-media')
                    alert(`${file.name} is not an image file`)
                    continue
                }
                // 100GB limit - matches storage bucket config
                if (file.size > 100 * 1024 * 1024 * 1024) {
                    logValidationRejection(file, 'File exceeds 100GB limit', 'employee_task_photo', 'task-media')
                    alert(`${file.name} must be less than 100GB`)
                    continue
                }
                newFiles.push(file)
                newPreviews.push(URL.createObjectURL(file))
            }

            setPhotoFiles(prev => [...prev, ...newFiles])
            setPhotoPreviews(prev => [...prev, ...newPreviews])
        }
        // Reset input so selecting the same file or re-capturing triggers onChange
        if (photoInputRef.current) photoInputRef.current.value = ''
    }

    // Remove a photo from the selection
    function removePhoto(index: number) {
        if (!confirm('Are you sure you want to remove this photo?')) return
        setPhotoFiles(prev => prev.filter((_, i) => i !== index))
        setPhotoPreviews(prev => {
            // Revoke the URL to prevent memory leaks
            URL.revokeObjectURL(prev[index])
            return prev.filter((_, i) => i !== index)
        })
    }

    // Remove an existing photo (for edit mode)
    function removeExistingPhoto(index: number) {
        if (!confirm('Are you sure you want to remove this photo?')) return
        setExistingPhotoUrls(prev => prev.filter((_, i) => i !== index))
        setEditSignedPhotoUrls(prev => prev.filter((_, i) => i !== index))
    }

    // Known video extensions for fallback when file.type is empty (common on Android)
    const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'webm', 'avi', 'mpeg', 'mpg', '3gp', '3g2', 'mkv', 'm4v'])

    // Handle video file selection (multiple)
    function handleVideoChange(e: React.ChangeEvent<HTMLInputElement>) {
        const files = e.target.files
        if (files && files.length > 0) {
            const newFiles: File[] = []
            const newPreviews: string[] = []

            for (let i = 0; i < files.length; i++) {
                const file = files[i]
                // Check MIME type first; fall back to extension for Android devices that report empty type
                const ext = file.name.split('.').pop()?.toLowerCase() || ''
                const isVideo = file.type.startsWith('video/') || (!file.type && VIDEO_EXTENSIONS.has(ext))
                if (!isVideo) {
                    logValidationRejection(file, 'Not a video file', 'employee_task_video', 'task-media')
                    alert(`${file.name} is not a video file`)
                    continue
                }
                // 100GB limit - matches storage bucket config
                if (file.size > 100 * 1024 * 1024 * 1024) {
                    logValidationRejection(file, 'File exceeds 100GB limit', 'employee_task_video', 'task-media')
                    alert(`${file.name} must be less than 100GB`)
                    continue
                }
                newFiles.push(file)
                newPreviews.push(URL.createObjectURL(file))
            }

            setVideoFiles(prev => [...prev, ...newFiles])
            setVideoPreviews(prev => [...prev, ...newPreviews])
        }
        // Reset input so recording/selecting the same file again triggers onChange
        if (videoRecordRef.current) videoRecordRef.current.value = ''
        if (videoInputRef.current) videoInputRef.current.value = ''
    }

    // Remove a video from the new uploads
    function removeNewVideo(index: number) {
        if (!confirm('Are you sure you want to remove this video?')) return
        URL.revokeObjectURL(videoPreviews[index])
        setVideoFiles(prev => prev.filter((_, i) => i !== index))
        setVideoPreviews(prev => prev.filter((_, i) => i !== index))
    }

    // Remove an existing video when editing
    function removeExistingVideo(index: number) {
        if (!confirm('Are you sure you want to remove this video?')) return
        setExistingVideoUrls(prev => prev.filter((_, i) => i !== index))
        setEditSignedVideoUrls(prev => prev.filter((_, i) => i !== index))
    }

    // Upload multiple videos - returns both successful URLs and failure count
    async function uploadVideos(files: File[], taskId: string): Promise<{ urls: string[]; failed: number }> {
        const uploadedUrls: string[] = []
        let failed = 0
        for (let i = 0; i < files.length; i++) {
            try {
                const url = await uploadFile(files[i], 'video', taskId, i)
                if (url) uploadedUrls.push(url)
            } catch (err) {
                failed++
                console.error(`Video ${i + 1} upload failed:`, err)
            }
        }
        return { urls: uploadedUrls, failed }
    }

    // Upload file to Supabase storage
    async function uploadFile(file: File, type: 'photo' | 'video', taskId: string, index?: number): Promise<string | null> {
        if (!user?.id) {
            console.error('Cannot upload: user not authenticated')
            throw new Error('User not authenticated')
        }
        const uploadContext = type === 'photo' ? 'employee_task_photo' : 'employee_task_video' as const
        const tracker = startUpload(file, 'task-media', uploadContext, taskId)

        const fileExt = file.name.split('.').pop()
        const indexStr = index !== undefined ? `_${index}` : ''
        const fileName = `${taskId}_${type}${indexStr}_${Date.now()}.${fileExt}`
        // Path structure: user_id/filename (to match storage policy)
        const filePath = `${user.id}/${fileName}`

        setUploadProgress(`Uploading ${type}${index !== undefined ? ` ${index + 1}` : ''}...`)

        if (shouldUseTus(file)) {
            // Use TUS resumable upload for large videos
            const label = `${type}${index !== undefined ? ` ${index + 1}` : ''}`
            const { promise, abort } = resumableUpload({
                bucketName: 'task-media',
                objectName: filePath,
                file,
                onProgress(pct) {
                    setUploadPercent(pct)
                    setUploadProgress(`Uploading ${label}... ${pct}%`)
                },
                onOffline(pct) {
                    setUploadProgress(`No internet. ${pct}% uploaded. Will resume when back online.`)
                },
                onOnline(pct) {
                    setUploadProgress(`Reconnected. Resuming upload... ${pct}%`)
                },
            })
            uploadAbortRef.current = abort

            try {
                await promise
                uploadAbortRef.current = null
                tracker.success(filePath)
                return filePath
            } catch (err) {
                uploadAbortRef.current = null
                tracker.failure(err)
                console.error(`Error uploading ${type}:`, err)
                throw err
            }
        }

        // Standard upload for small files
        const supabase = createUntypedClient()
        const { error: uploadError } = await supabase.storage
            .from('task-media')
            .upload(filePath, file, {
                cacheControl: '3600',
                upsert: false
            })

        if (uploadError) {
            tracker.failure(uploadError)
            console.error(`Error uploading ${type}:`, uploadError)
            throw uploadError
        }

        tracker.success(filePath)
        // Return the file path instead of public URL since bucket is private
        // We'll generate signed URLs when displaying
        return filePath
    }

    // Upload multiple photos - returns both successful URLs and failure count
    async function uploadPhotos(files: File[], taskId: string): Promise<{ urls: string[]; failed: number }> {
        const uploadedUrls: string[] = []
        let failed = 0
        for (let i = 0; i < files.length; i++) {
            try {
                const url = await uploadFile(files[i], 'photo', taskId, i)
                if (url) uploadedUrls.push(url)
            } catch (err) {
                failed++
                console.error(`Photo ${i + 1} upload failed:`, err)
            }
        }
        return { urls: uploadedUrls, failed }
    }

    function resetForm() {
        setNotes('')
        // Clean up photo preview URLs
        photoPreviews.forEach(url => URL.revokeObjectURL(url))
        setPhotoFiles([])
        setPhotoPreviews([])
        // Clean up video preview URLs
        videoPreviews.forEach(url => URL.revokeObjectURL(url))
        setVideoFiles([])
        setVideoPreviews([])
        setUploadProgress('')
        setUploadPercent(0)
        setExistingPhotoUrls([])
        setEditSignedPhotoUrls([])
        setExistingVideoUrls([])
        setEditSignedVideoUrls([])
    }

    // Generate signed URLs when viewing a task
    useEffect(() => {
        let stale = false
        async function loadSignedUrls() {
            if (viewingTask) {
                // Load multiple photo URLs (employee submission)
                const photoUrls: string[] = []
                if (viewingTask.photo_urls && viewingTask.photo_urls.length > 0) {
                    for (const url of viewingTask.photo_urls) {
                        if (stale) return
                        const signed = await getSignedStorageUrl(url)
                        if (signed) photoUrls.push(signed)
                    }
                } else if (viewingTask.photo_url) {
                    const signed = await getSignedStorageUrl(viewingTask.photo_url)
                    if (signed) photoUrls.push(signed)
                }
                if (stale) return
                setSignedPhotoUrls(photoUrls)

                // Load multiple video URLs (employee submission)
                const videoUrls: string[] = []
                if (viewingTask.video_urls && viewingTask.video_urls.length > 0) {
                    for (const url of viewingTask.video_urls) {
                        if (stale) return
                        const signed = await getSignedStorageUrl(url)
                        if (signed) videoUrls.push(signed)
                    }
                } else if (viewingTask.video_url) {
                    const signed = await getSignedStorageUrl(viewingTask.video_url)
                    if (signed) videoUrls.push(signed)
                }
                if (stale) return
                setSignedVideoUrls(videoUrls)

                // Load reference images (task definition examples)
                const refImageUrls: string[] = []
                if (viewingTask.tasks?.reference_images && viewingTask.tasks.reference_images.length > 0) {
                    for (const url of viewingTask.tasks.reference_images) {
                        if (stale) return
                        const signed = await getSignedStorageUrl(url)
                        if (signed) refImageUrls.push(signed)
                    }
                }
                if (stale) return
                setSignedRefImageUrls(refImageUrls)

                // Load reference videos (task definition examples)
                const refVideoUrls: string[] = []
                if (viewingTask.tasks?.reference_videos && viewingTask.tasks.reference_videos.length > 0) {
                    for (const url of viewingTask.tasks.reference_videos) {
                        if (stale) return
                        const signed = await getSignedStorageUrl(url)
                        if (signed) refVideoUrls.push(signed)
                    }
                }
                if (stale) return
                setSignedRefVideoUrls(refVideoUrls)
            } else {
                setSignedPhotoUrls([])
                setSignedVideoUrls([])
                setSignedRefImageUrls([])
                setSignedRefVideoUrls([])
            }
        }
        loadSignedUrls()
        return () => { stale = true }
    }, [viewingTask])

    // Load reference images when selecting a task to complete
    useEffect(() => {
        let stale = false
        async function loadSelectedRefImages() {
            if (selectedTask?.tasks?.reference_images && selectedTask.tasks.reference_images.length > 0) {
                const urls: string[] = []
                for (const path of selectedTask.tasks.reference_images) {
                    const signed = await getSignedStorageUrl(path)
                    if (signed) urls.push(signed)
                }
                if (!stale) setSelectedRefImageUrls(urls)
            } else {
                if (!stale) setSelectedRefImageUrls([])
            }
        }
        loadSelectedRefImages()
        return () => { stale = true }
    }, [selectedTask])

    // Open edit modal with current values
    async function openEditModal(task: TaskInstance) {
        setEditingTask(task)
        setNotes(task.notes || '')

        // Generate signed URLs for existing photos
        const photoUrls: string[] = []
        const signedUrls: string[] = []

        // First check photo_urls array
        if (task.photo_urls && task.photo_urls.length > 0) {
            for (const url of task.photo_urls) {
                photoUrls.push(url)
                const signed = await getSignedStorageUrl(url)
                if (signed) signedUrls.push(signed)
            }
        }
        // Fallback to single photo_url for backward compatibility
        else if (task.photo_url) {
            photoUrls.push(task.photo_url)
            const signed = await getSignedStorageUrl(task.photo_url)
            if (signed) signedUrls.push(signed)
        }

        setExistingPhotoUrls(photoUrls)
        setEditSignedPhotoUrls(signedUrls)

        // Generate signed URLs for existing videos
        const videoUrls: string[] = []
        const signedVideoUrls: string[] = []

        // First check video_urls array
        if (task.video_urls && task.video_urls.length > 0) {
            for (const url of task.video_urls) {
                videoUrls.push(url)
                const signed = await getSignedStorageUrl(url)
                if (signed) signedVideoUrls.push(signed)
            }
        }
        // Fallback to single video_url for backward compatibility
        else if (task.video_url) {
            videoUrls.push(task.video_url)
            const signed = await getSignedStorageUrl(task.video_url)
            if (signed) signedVideoUrls.push(signed)
        }

        setExistingVideoUrls(videoUrls)
        setEditSignedVideoUrls(signedVideoUrls)
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
            // Combine existing photos with new uploads
            let photoUrls: string[] = [...existingPhotoUrls]
            let photosFailed = 0

            // Upload new photos if provided
            if (photoFiles.length > 0) {
                const result = await uploadPhotos(photoFiles, taskInstance.id)
                photoUrls = [...photoUrls, ...result.urls]
                photosFailed = result.failed
            }

            // Combine existing videos with new uploads
            let videoUrls: string[] = [...existingVideoUrls]
            let videosFailed = 0

            // Upload new videos if provided
            if (videoFiles.length > 0) {
                const result = await uploadVideos(videoFiles, taskInstance.id)
                videoUrls = [...videoUrls, ...result.urls]
                videosFailed = result.failed
            }

            // Block save if required photos are now empty due to failures
            if (taskInstance.tasks?.requires_photo && photoUrls.length === 0) {
                alert(`All photo uploads failed. At least one photo is required. Please try again.`)
                return
            }

            // Block save if required videos are now empty due to failures
            if (taskInstance.tasks?.requires_video && videoUrls.length === 0) {
                alert(`All video uploads failed. At least one video is required. Please try again.`)
                return
            }

            setUploadProgress('Saving changes...')

            const supabase = createUntypedClient()
            const { error } = await supabase
                .from('task_instances')
                .update({
                    notes: notes || null,
                    photo_urls: photoUrls.length > 0 ? photoUrls : null,
                    photo_url: photoUrls.length > 0 ? photoUrls[0] : null, // Keep backward compatibility
                    video_urls: videoUrls.length > 0 ? videoUrls : null,
                    video_url: videoUrls.length > 0 ? videoUrls[0] : null, // Keep backward compatibility
                })
                .eq('id', taskInstance.id)

            if (error) throw error

            logClientActivity({
                action: 'task_submission_updated',
                entityType: 'task_instance',
                entityId: taskInstance.id,
                entityName: taskInstance.tasks?.title,
                details: {
                    task_id: taskInstance.task_id,
                    scheduled_date: taskInstance.scheduled_date,
                    photo_count: photoUrls.length,
                    video_count: videoUrls.length,
                },
            })

            await loadTasks()
            setEditingTask(null)
            resetForm()

            // Warn if some (but not all) uploads failed
            const warnings: string[] = []
            if (photosFailed > 0) {
                warnings.push(`${photosFailed} of ${photoFiles.length} new photo(s) failed to upload`)
            }
            if (videosFailed > 0) {
                warnings.push(`${videosFailed} of ${videoFiles.length} new video(s) failed to upload`)
            }
            if (warnings.length > 0) {
                alert(`Submission updated, but with issues:\n${warnings.join('\n')}\n\nYou can edit again to re-upload the failed files.`)
            } else {
                alert('Submission updated successfully!')
            }
        } catch (err) {
            console.error('Error updating submission:', err)
            alert('Failed to update submission')
        } finally {
            setCompleting(false)
            setUploadProgress('')
        }
    }

    async function completeTask(taskInstance: TaskInstance) {
        if (!user?.id) {
            alert('You must be logged in to complete tasks')
            return
        }

        if (taskInstance.tasks?.requires_notes && !notes.trim()) {
            alert('Please add notes before completing this task')
            return
        }

        if (taskInstance.tasks?.requires_photo && photoFiles.length === 0) {
            alert('Please upload at least one photo before completing this task')
            return
        }

        if (taskInstance.tasks?.requires_video && videoFiles.length === 0) {
            alert('Please upload at least one video before completing this task')
            return
        }

        setCompleting(true)
        try {
            let photoUrls: string[] = []
            let videoUrls: string[] = []
            let photosFailed = 0
            let videosFailed = 0

            // Upload photos if provided
            if (photoFiles.length > 0) {
                const result = await uploadPhotos(photoFiles, taskInstance.id)
                photoUrls = result.urls
                photosFailed = result.failed
            }

            // Upload videos if provided
            if (videoFiles.length > 0) {
                const result = await uploadVideos(videoFiles, taskInstance.id)
                videoUrls = result.urls
                videosFailed = result.failed
            }

            // Block completion if ALL required photos failed
            if (taskInstance.tasks?.requires_photo && photoFiles.length > 0 && photoUrls.length === 0) {
                alert(`All ${photosFailed} photo(s) failed to upload. Please try again. If the problem persists, try using a different image format (JPG or PNG).`)
                return
            }

            // Block completion if ALL required videos failed
            if (taskInstance.tasks?.requires_video && videoFiles.length > 0 && videoUrls.length === 0) {
                alert(`All ${videosFailed} video(s) failed to upload. Please try again. If the problem persists, try converting the video to MP4 format.`)
                return
            }

            setUploadProgress('Saving task...')

            const supabase = createUntypedClient()
            const { error } = await supabase
                .from('task_instances')
                .update({
                    status: 'completed',
                    completed_at: new Date().toISOString(),
                    notes: notes || null,
                    photo_urls: photoUrls.length > 0 ? photoUrls : null,
                    photo_url: photoUrls.length > 0 ? photoUrls[0] : null, // Keep backward compatibility
                    video_urls: videoUrls.length > 0 ? videoUrls : null,
                    video_url: videoUrls.length > 0 ? videoUrls[0] : null, // Keep backward compatibility
                })
                .eq('id', taskInstance.id)

            if (error) throw error

            // Send email notification to managers (non-blocking)
            taskNotifications.completed(taskInstance.id, notes || undefined).catch(console.error)

            logClientActivity({
                action: 'task_completed',
                entityType: 'task_instance',
                entityId: taskInstance.id,
                entityName: taskInstance.tasks?.title,
                details: {
                    task_id: taskInstance.task_id,
                    scheduled_date: taskInstance.scheduled_date,
                    photo_count: photoUrls.length,
                    video_count: videoUrls.length,
                    has_notes: !!notes,
                },
            })

            await loadTasks()
            setSelectedTask(null)
            resetForm()

            // Warn if some (but not all) uploads failed
            const warnings: string[] = []
            if (photosFailed > 0 && photoUrls.length > 0) {
                warnings.push(`${photosFailed} of ${photoFiles.length} photo(s) failed to upload`)
            }
            if (videosFailed > 0 && videoUrls.length > 0) {
                warnings.push(`${videosFailed} of ${videoFiles.length} video(s) failed to upload`)
            }
            if (warnings.length > 0) {
                alert(`Task completed, but with issues:\n${warnings.join('\n')}\n\nYou can edit your submission to re-upload the failed files.`)
            } else {
                alert('Task completed successfully!')
            }
        } catch (err) {
            console.error('Error completing task:', err)
            alert('Failed to complete task')
        } finally {
            setCompleting(false)
            setUploadProgress('')
        }
    }

    // Extract unique locations for filter dropdown
    const uniqueLocations = useMemo(() => {
        const locations = new Set<string>()
        tasks.forEach(t => {
            if (t.tasks?.location) locations.add(t.tasks.location)
        })
        return Array.from(locations).sort()
    }, [tasks])

    // Client-side filtering
    const filteredTasks = useMemo(() => {
        return tasks.filter(task => {
            // Status filter
            if (filters.status !== 'all' && task.status !== filters.status) return false

            // Search filter (task title)
            if (filters.search) {
                const searchLower = filters.search.toLowerCase()
                const titleMatch = task.tasks?.title?.toLowerCase().includes(searchLower)
                const descMatch = task.tasks?.description?.toLowerCase().includes(searchLower)
                if (!titleMatch && !descMatch) return false
            }

            // Location filter
            if (filters.location && task.tasks?.location !== filters.location) return false

            // Date range filter
            if (filters.dateFrom && task.scheduled_date < filters.dateFrom) return false
            if (filters.dateTo && task.scheduled_date > filters.dateTo) return false

            // Submission filters (only apply to completed tasks)
            if (task.status === 'completed') {
                const hasPhotos = task.photo_url || (task.photo_urls && task.photo_urls.length > 0)
                if (filters.hasPhoto === 'yes' && !hasPhotos) return false
                if (filters.hasPhoto === 'no' && hasPhotos) return false
                const hasVideos = task.video_url || (task.video_urls && task.video_urls.length > 0)
                if (filters.hasVideo === 'yes' && !hasVideos) return false
                if (filters.hasVideo === 'no' && hasVideos) return false
                if (filters.hasNotes === 'yes' && !task.notes) return false
                if (filters.hasNotes === 'no' && task.notes) return false
            }

            return true
        })
    }, [tasks, filters])

    // Stats are always calculated from all tasks (not filtered)
    const pendingCount = tasks.filter((t) => t.status === 'pending').length
    const completedCount = tasks.filter((t) => t.status === 'completed').length

    // Handle stat card click
    const handleStatCardClick = (status: 'all' | 'pending' | 'completed') => {
        setFilters(prev => ({ ...prev, status }))
    }

    // Clear all filters
    const clearFilters = () => {
        setFilters({
            status: 'all',
            search: '',
            location: '',
            dateFrom: '',
            dateTo: '',
            hasPhoto: 'all',
            hasVideo: 'all',
            hasNotes: 'all',
        })
    }

    // Check if any filters are active
    const hasActiveFilters = filters.status !== 'all' ||
        filters.search !== '' ||
        filters.location !== '' ||
        filters.dateFrom !== '' ||
        filters.dateTo !== '' ||
        filters.hasPhoto !== 'all' ||
        filters.hasVideo !== 'all' ||
        filters.hasNotes !== 'all'

    return (
        <div className="space-y-4 sm:space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold">My Tasks</h1>
                    <p className="text-muted-foreground mt-1 text-sm sm:text-base">
                        View and complete your assigned tasks
                    </p>
                </div>
                <button
                    onClick={() => loadTasks()}
                    className="btn-outline btn-sm flex items-center gap-2"
                    disabled={loading}
                >
                    {loading ? 'Refreshing...' : 'Refresh'}
                </button>
            </div>

            {/* Summary - Clickable Cards */}
            <div className="grid grid-cols-3 gap-2 sm:gap-4">
                <button
                    onClick={() => handleStatCardClick('all')}
                    className={`card p-3 sm:p-4 text-left transition-all hover:shadow-md ${filters.status === 'all' ? 'ring-2 ring-primary' : ''}`}
                >
                    <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                            <p className="text-xs sm:text-sm text-muted-foreground truncate">Total</p>
                            <p className="text-lg sm:text-2xl font-bold">{tasks.length}</p>
                        </div>
                        <span className="text-lg sm:text-2xl flex-shrink-0">📋</span>
                    </div>
                </button>
                <button
                    onClick={() => handleStatCardClick('pending')}
                    className={`card p-3 sm:p-4 text-left transition-all hover:shadow-md ${filters.status === 'pending' ? 'ring-2 ring-yellow-500' : ''}`}
                >
                    <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                            <p className="text-xs sm:text-sm text-muted-foreground truncate">Pending</p>
                            <p className="text-lg sm:text-2xl font-bold text-yellow-600">{pendingCount}</p>
                        </div>
                        <span className="text-lg sm:text-2xl flex-shrink-0">⏳</span>
                    </div>
                </button>
                <button
                    onClick={() => handleStatCardClick('completed')}
                    className={`card p-3 sm:p-4 text-left transition-all hover:shadow-md ${filters.status === 'completed' ? 'ring-2 ring-green-500' : ''}`}
                >
                    <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                            <p className="text-xs sm:text-sm text-muted-foreground truncate">Completed</p>
                            <p className="text-lg sm:text-2xl font-bold text-green-600">{completedCount}</p>
                        </div>
                        <span className="text-lg sm:text-2xl flex-shrink-0">✅</span>
                    </div>
                </button>
            </div>

            {/* Filters Section */}
            <div className="card">
                <div className="p-3 sm:p-4 border-b">
                    <div className="flex items-center justify-between">
                        <button
                            onClick={() => setShowFilters(!showFilters)}
                            className="flex items-center gap-2 text-sm font-medium"
                        >
                            <span>🔍</span>
                            Filters
                            <span className={`transition-transform ${showFilters ? 'rotate-180' : ''}`}>▼</span>
                            {hasActiveFilters && (
                                <span className="ml-2 px-2 py-0.5 bg-primary text-primary-foreground text-xs rounded-full">
                                    Active
                                </span>
                            )}
                        </button>
                        {hasActiveFilters && (
                            <button
                                onClick={clearFilters}
                                className="text-sm text-muted-foreground hover:text-destructive"
                            >
                                Clear all
                            </button>
                        )}
                    </div>
                </div>

                {showFilters && (
                    <div className="p-3 sm:p-4 space-y-4">
                        {/* Search */}
                        <div>
                            <label className="text-sm font-medium mb-1 block">Search Task</label>
                            <input
                                type="text"
                                value={filters.search}
                                onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
                                placeholder="Search by title or description..."
                                className="input w-full"
                            />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                            {/* Status Filter */}
                            <div>
                                <label className="text-sm font-medium mb-1 block">Status</label>
                                <select
                                    value={filters.status}
                                    onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value as 'all' | 'pending' | 'completed' }))}
                                    className="input w-full"
                                >
                                    <option value="all">All Status</option>
                                    <option value="pending">Pending</option>
                                    <option value="completed">Completed</option>
                                </select>
                            </div>

                            {/* Location Filter */}
                            <div>
                                <label className="text-sm font-medium mb-1 block">Location</label>
                                <select
                                    value={filters.location}
                                    onChange={(e) => setFilters(prev => ({ ...prev, location: e.target.value }))}
                                    className="input w-full"
                                >
                                    <option value="">All Locations</option>
                                    {uniqueLocations.map(loc => (
                                        <option key={loc} value={loc}>{loc}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Date From */}
                            <div>
                                <label className="text-sm font-medium mb-1 block">From Date</label>
                                <input
                                    type="date"
                                    value={filters.dateFrom}
                                    onChange={(e) => setFilters(prev => ({ ...prev, dateFrom: e.target.value }))}
                                    className="input w-full"
                                />
                            </div>

                            {/* Date To */}
                            <div>
                                <label className="text-sm font-medium mb-1 block">To Date</label>
                                <input
                                    type="date"
                                    value={filters.dateTo}
                                    onChange={(e) => setFilters(prev => ({ ...prev, dateTo: e.target.value }))}
                                    className="input w-full"
                                />
                            </div>
                        </div>

                        {/* Submission Filters */}
                        <div className="border-t pt-4">
                            <p className="text-sm font-medium mb-2">Submission Details (Completed Tasks)</p>
                            <div className="grid grid-cols-3 gap-3 sm:gap-4">
                                <div>
                                    <label className="text-sm text-muted-foreground mb-1 block">Has Photo</label>
                                    <select
                                        value={filters.hasPhoto}
                                        onChange={(e) => setFilters(prev => ({ ...prev, hasPhoto: e.target.value as 'all' | 'yes' | 'no' }))}
                                        className="input w-full"
                                    >
                                        <option value="all">Any</option>
                                        <option value="yes">Yes</option>
                                        <option value="no">No</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-sm text-muted-foreground mb-1 block">Has Video</label>
                                    <select
                                        value={filters.hasVideo}
                                        onChange={(e) => setFilters(prev => ({ ...prev, hasVideo: e.target.value as 'all' | 'yes' | 'no' }))}
                                        className="input w-full"
                                    >
                                        <option value="all">Any</option>
                                        <option value="yes">Yes</option>
                                        <option value="no">No</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-sm text-muted-foreground mb-1 block">Has Notes</label>
                                    <select
                                        value={filters.hasNotes}
                                        onChange={(e) => setFilters(prev => ({ ...prev, hasNotes: e.target.value as 'all' | 'yes' | 'no' }))}
                                        className="input w-full"
                                    >
                                        <option value="all">Any</option>
                                        <option value="yes">Yes</option>
                                        <option value="no">No</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Results count */}
            {hasActiveFilters && (
                <div className="text-sm text-muted-foreground">
                    Showing {filteredTasks.length} of {tasks.length} tasks
                </div>
            )}

            {loading ? (
                <div className="space-y-3 sm:space-y-4">
                    {[...Array(5)].map((_, i) => (
                        <div key={i} className="h-20 sm:h-24 bg-muted rounded-lg animate-pulse"></div>
                    ))}
                </div>
            ) : filteredTasks.length === 0 ? (
                <div className="card p-6 sm:p-8 text-center">
                    <p className="text-muted-foreground text-sm sm:text-base">
                        {hasActiveFilters ? 'No tasks match your filters' : 'No tasks found'}
                    </p>
                    {hasActiveFilters && (
                        <button
                            onClick={clearFilters}
                            className="btn-outline mt-3"
                        >
                            Clear Filters
                        </button>
                    )}
                </div>
            ) : (
                <div className="space-y-3 sm:space-y-4">
                    {filteredTasks.map((task) => (
                        <div
                            key={task.id}
                            className="card cursor-pointer hover:shadow-md transition-shadow"
                            onClick={() => setViewingTask(task)}
                        >
                            <div className="p-4">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="flex items-start gap-3 flex-1">
                                        <span className={`text-2xl mt-1 flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                                            task.status === 'completed'
                                                ? 'bg-green-100 text-green-600'
                                                : task.status === 'overdue'
                                                    ? 'bg-red-100 text-red-600'
                                                    : 'bg-yellow-100 text-yellow-600'
                                        }`}>
                                            {task.status === 'completed' ? '✓' : task.status === 'overdue' ? '!' : '○'}
                                        </span>
                                        <div className="flex-1">
                                            <h3 className="font-semibold">
                                                {task.tasks?.title || 'Unknown Task'}
                                            </h3>
                                            {task.tasks?.description && (
                                                <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{task.tasks.description.replace(/<[^>]*>/g, ' ').replace(/&[^;]+;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)}</p>
                                            )}
                                            <div className="flex flex-wrap gap-2 mt-2 text-xs text-muted-foreground">
                                                <span>📅 {formatDateOnly(task.scheduled_date)}</span>
                                                {task.tasks?.location && (
                                                    <span>📍 {task.tasks.location}</span>
                                                )}
                                                {task.tasks?.cutoff_time && (
                                                    <span>⏰ Due by {formatTimeString(task.tasks.cutoff_time)}</span>
                                                )}
                                                {task.tasks?.is_recurring && (
                                                    <span>🔄 Repeats {task.tasks.frequency === 'daily' ? 'every day' : task.tasks.frequency === 'weekly' ? 'every week' : 'every month'}
                                                        {task.tasks.recurrence_days && task.tasks.recurrence_days.length > 0 && task.tasks.recurrence_days.length < 7
                                                            ? ` on ${task.tasks.recurrence_days.map(d => d.charAt(0).toUpperCase() + d.slice(1, 3)).join(', ')}`
                                                            : ''}
                                                    </span>
                                                )}
                                            </div>
                                            {task.status === 'completed' && task.notes && (
                                                <p className="text-sm text-muted-foreground mt-2 italic line-clamp-1">
                                                    Notes: {task.notes}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex flex-col items-end gap-2">
                                        <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                                            task.status === 'completed'
                                                ? 'bg-green-100 text-green-700'
                                                : task.status === 'overdue'
                                                    ? 'bg-red-100 text-red-700'
                                                    : 'bg-yellow-100 text-yellow-700'
                                        }`}>
                                            {task.status === 'completed' ? 'Completed' : task.status === 'overdue' ? 'Overdue' : 'Pending'}
                                        </span>
                                        {task.status === 'pending' && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setSelectedTask(task); }}
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
                <div className="fixed inset-0 z-50 overflow-y-auto">
                    <div
                        className="fixed inset-0 bg-black/50"
                        onClick={() => { setSelectedTask(null); resetForm() }}
                    ></div>
                    <div className="flex min-h-full items-center justify-center p-4">
                    <div className="relative card w-full max-w-md">
                        <div className="card-header">
                            <h2 className="card-title">Complete Task</h2>
                            <p className="card-description">{selectedTask.tasks?.title}</p>
                        </div>
                        <div className="card-content space-y-4">
                            {/* Reference Images - show examples */}
                            {selectedRefImageUrls.length > 0 && (
                                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                                    <p className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-2">
                                        🖼️ Reference Images ({selectedRefImageUrls.length})
                                    </p>
                                    <div className="grid grid-cols-3 gap-2">
                                        {selectedRefImageUrls.map((url, index) => (
                                            <a
                                                key={index}
                                                href={url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                            >
                                                <img
                                                    src={url}
                                                    alt={`Reference ${index + 1}`}
                                                    className="w-full h-20 object-cover rounded border border-blue-300 cursor-pointer hover:opacity-80"
                                                />
                                            </a>
                                        ))}
                                    </div>
                                    <p className="text-xs text-blue-500 mt-1">Click to view full size</p>
                                </div>
                            )}

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

                            {/* Photo Upload - Multiple */}
                            <div>
                                <label className="label mb-2 block">
                                    📷 Photos {selectedTask.tasks?.requires_photo && <span className="text-destructive">*</span>}
                                    {!selectedTask.tasks?.requires_photo && <span className="text-muted-foreground">(optional)</span>}
                                    <span className="text-xs text-muted-foreground ml-2">
                                        ({photoPreviews.length} selected)
                                    </span>
                                </label>
                                <input
                                    ref={photoInputRef}
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    onChange={handlePhotoChange}
                                    className="hidden"
                                />
                                {/* Photo previews grid */}
                                {photoPreviews.length > 0 && (
                                    <div className="grid grid-cols-3 gap-2 mb-2">
                                        {photoPreviews.map((preview, index) => (
                                            <div key={index} className="relative aspect-square">
                                                <img
                                                    src={preview}
                                                    alt={`Photo ${index + 1}`}
                                                    className="w-full h-full object-cover rounded-lg border"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => removePhoto(index)}
                                                    className="absolute -top-1 -right-1 bg-destructive text-white rounded-full w-5 h-5 flex items-center justify-center text-xs shadow"
                                                >
                                                    ✕
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <button
                                    type="button"
                                    onClick={() => photoInputRef.current?.click()}
                                    className="w-full h-16 border-2 border-dashed border-muted-foreground/25 rounded-lg hover:border-primary/50 transition-colors flex flex-col items-center justify-center gap-1 text-muted-foreground"
                                >
                                    <span className="text-xl">📷</span>
                                    <span className="text-xs">{photoPreviews.length > 0 ? 'Add more photos' : 'Click to upload photos'}</span>
                                </button>
                            </div>

                            {/* Video Upload */}
                            <div>
                                <label className="label mb-2 block">
                                    🎥 Video {selectedTask.tasks?.requires_video && <span className="text-destructive">*</span>}
                                    {!selectedTask.tasks?.requires_video && <span className="text-muted-foreground">(optional)</span>}
                                </label>
                                {/* Record input: capture opens native camera (no multiple so iOS shows camera option) */}
                                <input
                                    ref={videoRecordRef}
                                    type="file"
                                    accept="video/*"
                                    capture="environment"
                                    onChange={handleVideoChange}
                                    className="hidden"
                                />
                                {/* Upload input: no capture, multiple allowed for gallery picks */}
                                <input
                                    ref={videoInputRef}
                                    type="file"
                                    accept="video/*"
                                    multiple
                                    onChange={handleVideoChange}
                                    className="hidden"
                                />
                                <p className="text-xs text-muted-foreground mb-2">
                                    Tip: For best quality on iPhone, record with Camera app first, then use Upload. Or set Settings &gt; Camera &gt; Record Video to 1080p HD at 60fps.
                                </p>
                                {videoPreviews.length > 0 ? (
                                    <div className="space-y-2">
                                        {videoPreviews.map((preview, index) => (
                                            <div key={index} className="relative">
                                                <video
                                                    src={`${preview}#t=0.1`}
                                                    className="w-full h-32 object-cover rounded-lg border"
                                                    preload="metadata"
                                                    controls
                                                    playsInline
                                                    disablePictureInPicture
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => removeNewVideo(index)}
                                                    className="absolute top-2 right-2 bg-destructive text-white rounded-full w-6 h-6 flex items-center justify-center text-sm"
                                                >
                                                    ✕
                                                </button>
                                            </div>
                                        ))}
                                        <div className="flex gap-2">
                                            <button
                                                type="button"
                                                onClick={() => videoRecordRef.current?.click()}
                                                className="flex-1 h-12 border-2 border-dashed border-muted-foreground/25 rounded-lg hover:border-primary/50 transition-colors flex items-center justify-center gap-2 text-muted-foreground text-sm"
                                            >
                                                <span>📹</span>
                                                <span>Record</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => videoInputRef.current?.click()}
                                                className="flex-1 h-12 border-2 border-dashed border-muted-foreground/25 rounded-lg hover:border-primary/50 transition-colors flex items-center justify-center gap-2 text-muted-foreground text-sm"
                                            >
                                                <span>📁</span>
                                                <span>Upload</span>
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            onClick={() => videoRecordRef.current?.click()}
                                            className="flex-1 h-24 border-2 border-dashed border-muted-foreground/25 rounded-lg hover:border-primary/50 transition-colors flex flex-col items-center justify-center gap-2 text-muted-foreground"
                                        >
                                            <span className="text-2xl">📹</span>
                                            <span className="text-sm">Record Video</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => videoInputRef.current?.click()}
                                            className="flex-1 h-24 border-2 border-dashed border-muted-foreground/25 rounded-lg hover:border-primary/50 transition-colors flex flex-col items-center justify-center gap-2 text-muted-foreground"
                                        >
                                            <span className="text-2xl">📁</span>
                                            <span className="text-sm">Upload Video</span>
                                        </button>
                                    </div>
                                )}
                            </div>

                            {uploadProgress && (
                                <div className={`p-3 rounded-lg text-sm ${uploadProgress.includes('No internet') ? 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200' : uploadProgress.includes('Reconnected') ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200' : 'bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200'}`}>
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="flex-1 text-center">{uploadProgress.includes('No internet') ? '📡' : '⏳'} {uploadProgress}</span>
                                        {uploadAbortRef.current && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    uploadAbortRef.current?.()
                                                    uploadAbortRef.current = null
                                                    setUploadProgress('')
                                                    setUploadPercent(0)
                                                    setCompleting(false)
                                                }}
                                                className="ml-2 px-2 py-0.5 text-xs rounded bg-red-500 text-white hover:bg-red-600"
                                            >
                                                Cancel
                                            </button>
                                        )}
                                    </div>
                                    {uploadPercent > 0 && (
                                        <div className={`w-full rounded-full h-2 ${uploadProgress.includes('No internet') ? 'bg-red-200 dark:bg-red-800' : 'bg-blue-200 dark:bg-blue-800'}`}>
                                            <div className={`h-2 rounded-full transition-all duration-300 ${uploadProgress.includes('No internet') ? 'bg-red-500 dark:bg-red-400' : 'bg-blue-600 dark:bg-blue-400'}`}
                                                 style={{ width: `${uploadPercent}%` }} />
                                        </div>
                                    )}
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
                </div>
            )}

            {/* View Task Details Modal */}
            {viewingTask && (
                <div className="fixed inset-0 z-50 overflow-y-auto">
                    <div
                        className="fixed inset-0 bg-black/50"
                        onClick={() => setViewingTask(null)}
                    ></div>
                    <div className="flex min-h-full items-center justify-center p-4">
                    <div className="relative card w-full max-w-lg">
                        <div className="card-header">
                            <div className="flex items-start justify-between">
                                <div>
                                    <h2 className="card-title">{viewingTask.tasks?.title || 'Task Details'}</h2>
                                    <p className="card-description mt-1">Task Details</p>
                                </div>
                                <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                                    viewingTask.status === 'completed'
                                        ? 'bg-green-100 text-green-700'
                                        : viewingTask.status === 'overdue'
                                            ? 'bg-red-100 text-red-700'
                                            : 'bg-yellow-100 text-yellow-700'
                                }`}>
                                    {viewingTask.status === 'completed' ? 'Completed' : viewingTask.status === 'overdue' ? 'Overdue' : 'Pending'}
                                </span>
                            </div>
                        </div>
                        <div className="card-content space-y-4">
                            {/* Task Description */}
                            {viewingTask.tasks?.description && (
                                <div className="bg-muted/50 rounded-lg p-3 text-sm">
                                    <RichTextDisplay content={viewingTask.tasks.description} />
                                </div>
                            )}

                            {/* Task Info Grid */}
                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div className="bg-muted/30 rounded-lg p-3">
                                    <p className="text-muted-foreground text-xs">Scheduled Date</p>
                                    <p className="font-medium">📅 {formatDateOnly(viewingTask.scheduled_date)}</p>
                                </div>
                                {viewingTask.tasks?.location && (
                                    <div className="bg-muted/30 rounded-lg p-3">
                                        <p className="text-muted-foreground text-xs">Location</p>
                                        <p className="font-medium">📍 {viewingTask.tasks.location}</p>
                                    </div>
                                )}
                                {viewingTask.tasks?.cutoff_time && (
                                    <div className="bg-muted/30 rounded-lg p-3">
                                        <p className="text-muted-foreground text-xs">Deadline</p>
                                        <p className="font-medium">⏰ {formatTimeString(viewingTask.tasks.cutoff_time)}</p>
                                    </div>
                                )}
                                {viewingTask.status === 'completed' && viewingTask.completed_at && (
                                    <div className="bg-green-50 rounded-lg p-3">
                                        <p className="text-muted-foreground text-xs">Completed At</p>
                                        <p className="font-medium text-green-700">{formatDateTime(viewingTask.completed_at)}</p>
                                    </div>
                                )}
                                {viewingTask.tasks?.is_recurring && (
                                    <div className="bg-purple-50 rounded-lg p-3 col-span-2">
                                        <p className="text-muted-foreground text-xs">Schedule</p>
                                        <p className="font-medium text-purple-700">
                                            🔄 This task repeats {viewingTask.tasks.frequency === 'daily' ? 'every day' : viewingTask.tasks.frequency === 'weekly' ? 'every week' : 'every month'}
                                            {viewingTask.tasks.recurrence_days && viewingTask.tasks.recurrence_days.length > 0 && viewingTask.tasks.recurrence_days.length < 7
                                                ? ` on ${viewingTask.tasks.recurrence_days.map(d => d.charAt(0).toUpperCase() + d.slice(1)).join(', ')}`
                                                : ''}
                                        </p>
                                    </div>
                                )}
                            </div>

                            {/* Requirements */}
                            {(viewingTask.tasks?.requires_photo || viewingTask.tasks?.requires_video || viewingTask.tasks?.requires_notes) && (
                                <div className="flex flex-wrap gap-2">
                                    <span className="text-xs text-muted-foreground">Requirements:</span>
                                    {viewingTask.tasks?.requires_photo && (
                                        <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs">📷 Photo</span>
                                    )}
                                    {viewingTask.tasks?.requires_video && (
                                        <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs">🎥 Video</span>
                                    )}
                                    {viewingTask.tasks?.requires_notes && (
                                        <span className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded text-xs">📝 Notes</span>
                                    )}
                                </div>
                            )}

                            {/* Reference Images - Examples from task definition */}
                            {signedRefImageUrls.length > 0 && (
                                <div className="border-t pt-4">
                                    <p className="text-sm font-medium text-muted-foreground mb-2">
                                        🖼️ Reference Images ({signedRefImageUrls.length})
                                    </p>
                                    <div className="grid grid-cols-2 gap-2">
                                        {signedRefImageUrls.map((url, index) => (
                                            <a
                                                key={index}
                                                href={url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="block"
                                            >
                                                <img
                                                    src={url}
                                                    alt={`Reference ${index + 1}`}
                                                    className="w-full h-32 object-cover rounded-lg border border-primary/30 cursor-pointer hover:opacity-80 transition-opacity"
                                                />
                                            </a>
                                        ))}
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-1">Click to open full size</p>
                                </div>
                            )}

                            {/* Reference Videos */}
                            {signedRefVideoUrls.length > 0 && (
                                <div className="border-t pt-4">
                                    <p className="text-sm font-medium text-muted-foreground mb-2">
                                        🎥 Reference Videos ({signedRefVideoUrls.length})
                                    </p>
                                    <div className="space-y-2">
                                        {signedRefVideoUrls.map((url, index) => (
                                            <div key={index} className="relative group">
                                                <video
                                                    src={`${url}#t=0.1`}
                                                    className="w-full max-h-48 rounded-lg border"
                                                    preload="metadata"
                                                    controls
                                                    playsInline
                                                    disablePictureInPicture
                                                />
                                                <button
                                                    onClick={() => setFullscreenVideoUrl(url)}
                                                    className="absolute top-2 right-2 bg-black/60 hover:bg-black/80 text-white rounded-lg p-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
                                                    title="View fullscreen"
                                                >
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Employee Submission Section */}
                            {(viewingTask.notes || signedPhotoUrls.length > 0 || viewingTask.video_urls?.length || viewingTask.video_url) && (
                                <div className="border-t pt-4">
                                    <p className="text-sm font-semibold mb-3">Your Submission</p>
                                </div>
                            )}

                            {viewingTask.notes && (
                                <div>
                                    <p className="text-sm text-muted-foreground mb-1">📝 Notes</p>
                                    <p className="text-sm bg-muted p-3 rounded-lg">{viewingTask.notes}</p>
                                </div>
                            )}

                            {/* Photos - support multiple */}
                            {(signedPhotoUrls.length > 0 || viewingTask.photo_url) && (
                                <div>
                                    <p className="text-sm text-muted-foreground mb-2">
                                        📷 Photos ({signedPhotoUrls.length})
                                    </p>
                                    {signedPhotoUrls.length > 0 ? (
                                        <div className="grid grid-cols-2 gap-2">
                                            {signedPhotoUrls.map((url, index) => (
                                                <a
                                                    key={index}
                                                    href={url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="block"
                                                >
                                                    <img
                                                        src={url}
                                                        alt={`Task photo ${index + 1}`}
                                                        className="w-full h-32 object-cover rounded-lg border cursor-pointer hover:opacity-80 transition-opacity"
                                                    />
                                                </a>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-sm text-muted-foreground">Loading photos...</p>
                                    )}
                                    <p className="text-xs text-muted-foreground mt-1">Click to open full size</p>
                                </div>
                            )}

                            {(viewingTask.video_urls?.length || viewingTask.video_url) && (
                                <div>
                                    <p className="text-sm text-muted-foreground mb-2">
                                        🎥 Videos ({signedVideoUrls.length})
                                    </p>
                                    {signedVideoUrls.length > 0 ? (
                                        <div className="space-y-2">
                                            {signedVideoUrls.map((url, index) => (
                                                <div key={index} className="relative group">
                                                    <video
                                                        src={`${url}#t=0.1`}
                                                        className="w-full max-h-64 rounded-lg border"
                                                        preload="metadata"
                                                        controls
                                                        playsInline
                                                        disablePictureInPicture
                                                    />
                                                    <button
                                                        onClick={() => setFullscreenVideoUrl(url)}
                                                        className="absolute top-2 right-2 bg-black/60 hover:bg-black/80 text-white rounded-lg p-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
                                                        title="View fullscreen"
                                                    >
                                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-sm text-muted-foreground">Loading videos...</p>
                                    )}
                                </div>
                            )}

                            {!viewingTask.notes && signedPhotoUrls.length === 0 && signedVideoUrls.length === 0 && (
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
                            {viewingTask.status === 'pending' && (
                                <button
                                    onClick={() => {
                                        setViewingTask(null)
                                        setSelectedTask(viewingTask)
                                    }}
                                    className="btn-primary"
                                >
                                    ✓ Complete Task
                                </button>
                            )}
                            {viewingTask.status === 'completed' && (
                                <button
                                    onClick={() => openEditModal(viewingTask)}
                                    className="btn-primary"
                                >
                                    ✏️ Edit Submission
                                </button>
                            )}
                        </div>
                    </div>
                    </div>
                </div>
            )}

            {/* Edit Submission Modal */}
            {editingTask && (
                <div className="fixed inset-0 z-50 overflow-y-auto">
                    <div
                        className="fixed inset-0 bg-black/50"
                        onClick={() => {
                            setEditingTask(null)
                            resetForm()
                        }}
                    ></div>
                    <div className="flex min-h-full items-center justify-center p-4">
                    <div className="relative card w-full max-w-md">
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

                            {/* Photo Upload/Replace - Multiple */}
                            <div>
                                <label className="label mb-2 block">
                                    📷 Photos {editingTask.tasks?.requires_photo && <span className="text-destructive">*</span>}
                                    <span className="text-xs text-muted-foreground ml-2">
                                        ({editSignedPhotoUrls.length + photoPreviews.length} total)
                                    </span>
                                </label>
                                <input
                                    ref={photoInputRef}
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    onChange={handlePhotoChange}
                                    className="hidden"
                                />
                                {/* Existing photos grid */}
                                {editSignedPhotoUrls.length > 0 && (
                                    <div className="mb-2">
                                        <p className="text-xs text-muted-foreground mb-1">Current photos:</p>
                                        <div className="grid grid-cols-3 gap-2">
                                            {editSignedPhotoUrls.map((url, index) => (
                                                <div key={`existing-${index}`} className="relative aspect-square">
                                                    <img
                                                        src={url}
                                                        alt={`Current photo ${index + 1}`}
                                                        className="w-full h-full object-cover rounded-lg border"
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => removeExistingPhoto(index)}
                                                        className="absolute -top-1 -right-1 bg-destructive text-white rounded-full w-5 h-5 flex items-center justify-center text-xs shadow"
                                                    >
                                                        ✕
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {/* New photos grid */}
                                {photoPreviews.length > 0 && (
                                    <div className="mb-2">
                                        <p className="text-xs text-muted-foreground mb-1">New photos to add:</p>
                                        <div className="grid grid-cols-3 gap-2">
                                            {photoPreviews.map((preview, index) => (
                                                <div key={`new-${index}`} className="relative aspect-square">
                                                    <img
                                                        src={preview}
                                                        alt={`New photo ${index + 1}`}
                                                        className="w-full h-full object-cover rounded-lg border border-primary"
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => removePhoto(index)}
                                                        className="absolute -top-1 -right-1 bg-destructive text-white rounded-full w-5 h-5 flex items-center justify-center text-xs shadow"
                                                    >
                                                        ✕
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                <button
                                    type="button"
                                    onClick={() => photoInputRef.current?.click()}
                                    className="w-full h-16 border-2 border-dashed border-muted-foreground/25 rounded-lg hover:border-primary/50 transition-colors flex flex-col items-center justify-center gap-1 text-muted-foreground"
                                >
                                    <span className="text-xl">📷</span>
                                    <span className="text-xs">Add more photos</span>
                                </button>
                            </div>

                            {/* Video Upload/Edit - Multiple */}
                            <div>
                                <label className="label mb-2 block">
                                    🎥 Videos {editingTask.tasks?.requires_video && <span className="text-destructive">*</span>}
                                </label>
                                {/* Record input: capture opens native camera */}
                                <input
                                    ref={videoRecordRef}
                                    type="file"
                                    accept="video/*"
                                    capture="environment"
                                    onChange={handleVideoChange}
                                    className="hidden"
                                />
                                {/* Upload input: no capture, multiple for gallery picks */}
                                <input
                                    ref={videoInputRef}
                                    type="file"
                                    accept="video/*"
                                    multiple
                                    onChange={handleVideoChange}
                                    className="hidden"
                                />
                                <p className="text-xs text-muted-foreground mb-2">
                                    Tip: For best quality on iPhone, record with Camera app first, then use Upload. Or set Settings &gt; Camera &gt; Record Video to 1080p HD at 60fps.
                                </p>
                                {/* Existing videos */}
                                {editSignedVideoUrls.length > 0 && (
                                    <div className="mb-2">
                                        <p className="text-xs text-muted-foreground mb-1">Current videos:</p>
                                        <div className="space-y-2">
                                            {editSignedVideoUrls.map((url, index) => (
                                                <div key={`existing-video-${index}`} className="relative">
                                                    <video
                                                        src={`${url}#t=0.1`}
                                                        className="w-full h-32 object-cover rounded-lg border"
                                                        preload="metadata"
                                                        controls
                                                        playsInline
                                                        disablePictureInPicture
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => removeExistingVideo(index)}
                                                        className="absolute top-2 right-2 bg-destructive text-white rounded-full w-5 h-5 flex items-center justify-center text-xs shadow"
                                                    >
                                                        ✕
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {/* New videos to upload */}
                                {videoPreviews.length > 0 && (
                                    <div className="mb-2">
                                        <p className="text-xs text-muted-foreground mb-1">New videos to upload:</p>
                                        <div className="space-y-2">
                                            {videoPreviews.map((preview, index) => (
                                                <div key={`new-video-${index}`} className="relative">
                                                    <video
                                                        src={`${preview}#t=0.1`}
                                                        className="w-full h-32 object-cover rounded-lg border"
                                                        preload="metadata"
                                                        controls
                                                        playsInline
                                                        disablePictureInPicture
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => removeNewVideo(index)}
                                                        className="absolute top-2 right-2 bg-destructive text-white rounded-full w-5 h-5 flex items-center justify-center text-xs shadow"
                                                    >
                                                        ✕
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={() => videoRecordRef.current?.click()}
                                        className="flex-1 h-14 border-2 border-dashed border-muted-foreground/25 rounded-lg hover:border-primary/50 transition-colors flex items-center justify-center gap-2 text-muted-foreground"
                                    >
                                        <span className="text-lg">📹</span>
                                        <span className="text-xs">Record</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => videoInputRef.current?.click()}
                                        className="flex-1 h-14 border-2 border-dashed border-muted-foreground/25 rounded-lg hover:border-primary/50 transition-colors flex items-center justify-center gap-2 text-muted-foreground"
                                    >
                                        <span className="text-lg">📁</span>
                                        <span className="text-xs">Upload</span>
                                    </button>
                                </div>
                            </div>

                            {uploadProgress && (
                                <div className={`p-3 rounded-lg text-sm ${uploadProgress.includes('No internet') ? 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200' : uploadProgress.includes('Reconnected') ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200' : 'bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200'}`}>
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="flex-1 text-center">{uploadProgress.includes('No internet') ? '📡' : '⏳'} {uploadProgress}</span>
                                        {uploadAbortRef.current && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    uploadAbortRef.current?.()
                                                    uploadAbortRef.current = null
                                                    setUploadProgress('')
                                                    setUploadPercent(0)
                                                    setCompleting(false)
                                                }}
                                                className="ml-2 px-2 py-0.5 text-xs rounded bg-red-500 text-white hover:bg-red-600"
                                            >
                                                Cancel
                                            </button>
                                        )}
                                    </div>
                                    {uploadPercent > 0 && (
                                        <div className={`w-full rounded-full h-2 ${uploadProgress.includes('No internet') ? 'bg-red-200 dark:bg-red-800' : 'bg-blue-200 dark:bg-blue-800'}`}>
                                            <div className={`h-2 rounded-full transition-all duration-300 ${uploadProgress.includes('No internet') ? 'bg-red-500 dark:bg-red-400' : 'bg-blue-600 dark:bg-blue-400'}`}
                                                 style={{ width: `${uploadPercent}%` }} />
                                        </div>
                                    )}
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
                </div>
            )}

            {/* Fullscreen Video Overlay */}
            {fullscreenVideoUrl && (
                <div className="fixed inset-0 z-[200] bg-black flex items-center justify-center" onClick={() => setFullscreenVideoUrl(null)}>
                    <button
                        onClick={() => setFullscreenVideoUrl(null)}
                        className="absolute top-4 right-4 text-white bg-white/20 hover:bg-white/30 rounded-full p-2 z-10"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                    <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: '100vw', maxHeight: '100vh' }}>
                        <VideoPlayer
                            src={fullscreenVideoUrl}
                            autoPlay
                            className="w-screen h-screen"
                        />
                    </div>
                </div>
            )}
        </div>
    )
}
