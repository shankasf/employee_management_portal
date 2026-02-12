'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { createUntypedClient } from '@/lib/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { useTasks, useActiveEmployees, useTaskInstances, invalidateQueries } from '@/lib/hooks/useData'
import { taskNotifications } from '@/lib/notifications'
import { getTodayNY, getDateNY, formatScheduleDate, formatDateTime, formatTimeString, getSignedStorageUrl } from '@/lib/utils'
import { RichTextEditor, RichTextDisplay } from '@/components/RichTextEditor'

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
    reference_images: string[] | null
    reference_videos: string[] | null
    created_at: string
}

interface ActiveEmployee {
    id: string
    display_name: string | null
    position: string | null
}

interface TaskInstance {
    id: string
    task_id: string
    employee_id: string
    scheduled_date: string
    status: 'pending' | 'completed' | 'overdue'
    completed_at: string | null
    notes: string | null
    photo_url: string | null
    photo_urls: string[] | null
    video_url: string | null
    video_urls: string[] | null
    created_at: string
    tasks: {
        id: string
        title: string
        description: string | null
        location: string | null
        cutoff_time: string | null
        is_recurring: boolean
        frequency: string | null
        requires_photo: boolean
        requires_video: boolean
        requires_notes: boolean
        reference_images: string[] | null
        reference_videos: string[] | null
    } | null
    employees: {
        id: string
        display_name: string | null
        position: string | null
        profiles: {
            email: string | null
            full_name: string | null
        } | null
    } | null
}

export default function TasksPage() {
    const { user } = useAuth()
    const { data: tasks = [], isLoading: loading, mutate } = useTasks()
    const { data: employees = [] } = useActiveEmployees()
    const [showModal, setShowModal] = useState(false)
    const [showAssignModal, setShowAssignModal] = useState(false)
    const [showDetailModal, setShowDetailModal] = useState(false)
    const [viewingInstance, setViewingInstance] = useState<TaskInstance | null>(null)
    const [signedPhotoUrls, setSignedPhotoUrls] = useState<string[]>([])
    const [signedVideoUrls, setSignedVideoUrls] = useState<string[]>([])
    const [signedRefImageUrls, setSignedRefImageUrls] = useState<string[]>([])
    const [signedRefVideoUrls, setSignedRefVideoUrls] = useState<string[]>([])
    const [editingTask, setEditingTask] = useState<Task | null>(null)
    const [assigningTask, setAssigningTask] = useState<Task | null>(null)
    const [viewingTask, setViewingTask] = useState<Task | null>(null)
    const [showTaskDetailModal, setShowTaskDetailModal] = useState(false)
    const [taskDetailRefImageUrls, setTaskDetailRefImageUrls] = useState<string[]>([])
    const [taskDetailRefVideoUrls, setTaskDetailRefVideoUrls] = useState<string[]>([])
    const [saving, setSaving] = useState(false)
    const [activeTab, setActiveTab] = useState<'definitions' | 'assigned'>('assigned')

    // Multi-select for bulk operations
    const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set())
    const [showBulkAssignModal, setShowBulkAssignModal] = useState(false)
    const [bulkAssignData, setBulkAssignData] = useState({
        employee_id: '',
        scheduled_date: getTodayNY()
    })

    // Reference images for task creation/editing
    const [refImageFiles, setRefImageFiles] = useState<File[]>([])
    const [refImagePreviews, setRefImagePreviews] = useState<string[]>([])
    const [existingRefImages, setExistingRefImages] = useState<string[]>([])
    const [existingRefImageUrls, setExistingRefImageUrls] = useState<string[]>([])
    const refImageInputRef = useRef<HTMLInputElement>(null)

    // Reference videos for task creation/editing
    const [refVideoFiles, setRefVideoFiles] = useState<File[]>([])
    const [refVideoPreviews, setRefVideoPreviews] = useState<string[]>([])
    const [existingRefVideos, setExistingRefVideos] = useState<string[]>([])
    const [existingRefVideoUrls, setExistingRefVideoUrls] = useState<string[]>([])
    const [videoUploadProgress, setVideoUploadProgress] = useState<string>('')
    const refVideoInputRef = useRef<HTMLInputElement>(null)

    // Filters for assigned tasks table
    const [filters, setFilters] = useState({
        startDate: getDateNY(-30),
        endDate: getDateNY(30),
        status: 'all',
        employeeId: 'all',
        taskId: 'all',
        location: 'all',
        hasSubmission: 'all',
    })

    // Filters for task definitions tab
    const [definitionFilters, setDefinitionFilters] = useState({
        search: '',
        location: 'all',
        roleTarget: 'all',
        recurring: 'all',
        requirement: 'all',
    })

    // Handle stat card click to filter by status
    function handleStatCardClick(status: 'all' | 'pending' | 'completed' | 'overdue') {
        setFilters(prev => ({ ...prev, status }))
    }

    // Clear all filters
    function clearFilters() {
        setFilters({
            startDate: getDateNY(-30),
            endDate: getDateNY(30),
            status: 'all',
            employeeId: 'all',
            taskId: 'all',
            location: 'all',
            hasSubmission: 'all',
        })
    }

    // Clear definition filters
    function clearDefinitionFilters() {
        setDefinitionFilters({
            search: '',
            location: 'all',
            roleTarget: 'all',
            recurring: 'all',
            requirement: 'all',
        })
    }

    // Get unique locations from task definitions
    const uniqueTaskLocations = useMemo(() => {
        const locations = new Set<string>()
        tasks.forEach((task: Task) => {
            if (task.location) {
                locations.add(task.location)
            }
        })
        return Array.from(locations).sort()
    }, [tasks])

    // Filter task definitions
    const filteredTasks = useMemo(() => {
        return tasks.filter((task: Task) => {
            // Search filter
            if (definitionFilters.search) {
                const searchLower = definitionFilters.search.toLowerCase()
                const matchesTitle = task.title.toLowerCase().includes(searchLower)
                const matchesDescription = task.description?.toLowerCase().includes(searchLower)
                if (!matchesTitle && !matchesDescription) return false
            }
            // Location filter
            if (definitionFilters.location !== 'all' && task.location !== definitionFilters.location) {
                return false
            }
            // Role target filter
            if (definitionFilters.roleTarget !== 'all' && task.role_target !== definitionFilters.roleTarget) {
                return false
            }
            // Recurring filter
            if (definitionFilters.recurring !== 'all') {
                if (definitionFilters.recurring === 'yes' && !task.is_recurring) return false
                if (definitionFilters.recurring === 'no' && task.is_recurring) return false
            }
            // Requirement filter
            if (definitionFilters.requirement !== 'all') {
                switch (definitionFilters.requirement) {
                    case 'photo':
                        if (!task.requires_photo) return false
                        break
                    case 'video':
                        if (!task.requires_video) return false
                        break
                    case 'notes':
                        if (!task.requires_notes) return false
                        break
                    case 'any':
                        if (!task.requires_photo && !task.requires_video && !task.requires_notes) return false
                        break
                    case 'none':
                        if (task.requires_photo || task.requires_video || task.requires_notes) return false
                        break
                }
            }
            return true
        })
    }, [tasks, definitionFilters])

    // Check if any definition filter is active
    const hasActiveDefinitionFilters = definitionFilters.search !== '' ||
        definitionFilters.location !== 'all' ||
        definitionFilters.roleTarget !== 'all' ||
        definitionFilters.recurring !== 'all' ||
        definitionFilters.requirement !== 'all'

    // Fetch assigned task instances - status filter is applied client-side to keep stats accurate
    const instanceFilters = useMemo(() => ({
        startDate: filters.startDate,
        endDate: filters.endDate,
        status: 'all', // Always fetch all statuses, filter client-side
        employeeId: filters.employeeId,
    }), [filters.startDate, filters.endDate, filters.employeeId])

    const { data: taskInstances = [], isLoading: instancesLoading, mutate: mutateInstances } = useTaskInstances(instanceFilters)

    // Get unique locations from task instances
    const uniqueLocations = useMemo(() => {
        const locations = new Set<string>()
        taskInstances.forEach((instance: TaskInstance) => {
            if (instance.tasks?.location) {
                locations.add(instance.tasks.location)
            }
        })
        return Array.from(locations).sort()
    }, [taskInstances])

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
        requires_notes: false,
        // Optional immediate assignment
        assign_now: false,
        employee_id: '',
        scheduled_date: getTodayNY()
    })

    // Assignment form state
    const [assignData, setAssignData] = useState({
        employee_id: '',
        scheduled_date: getTodayNY()
    })

    async function openModal(task?: Task) {
        // Reset reference images state
        refImagePreviews.forEach(url => URL.revokeObjectURL(url))
        setRefImageFiles([])
        setRefImagePreviews([])
        setExistingRefImages([])
        setExistingRefImageUrls([])

        // Reset reference videos state
        refVideoPreviews.forEach(url => URL.revokeObjectURL(url))
        setRefVideoFiles([])
        setRefVideoPreviews([])
        setExistingRefVideos([])
        setExistingRefVideoUrls([])
        setVideoUploadProgress('')

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
                requires_notes: task.requires_notes,
                assign_now: false,
                employee_id: '',
                scheduled_date: getTodayNY()
            })
            // Load existing reference images
            if (task.reference_images && task.reference_images.length > 0) {
                setExistingRefImages(task.reference_images)
                const signedUrls: string[] = []
                for (const path of task.reference_images) {
                    const signed = await getSignedStorageUrl(path, 'task-media')
                    if (signed) signedUrls.push(signed)
                }
                setExistingRefImageUrls(signedUrls)
            }
            // Load existing reference videos
            if (task.reference_videos && task.reference_videos.length > 0) {
                setExistingRefVideos(task.reference_videos)
                const signedUrls: string[] = []
                for (const path of task.reference_videos) {
                    const signed = await getSignedStorageUrl(path, 'task-media')
                    if (signed) signedUrls.push(signed)
                }
                setExistingRefVideoUrls(signedUrls)
            }
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
                requires_notes: false,
                assign_now: false,
                employee_id: '',
                scheduled_date: getTodayNY()
            })
        }
        setShowModal(true)
    }

    function closeModal() {
        setShowModal(false)
        setEditingTask(null)
        refImagePreviews.forEach(url => URL.revokeObjectURL(url))
        setRefImageFiles([])
        setRefImagePreviews([])
        setExistingRefImages([])
        setExistingRefImageUrls([])
        refVideoPreviews.forEach(url => URL.revokeObjectURL(url))
        setRefVideoFiles([])
        setRefVideoPreviews([])
        setExistingRefVideos([])
        setExistingRefVideoUrls([])
        setVideoUploadProgress('')
    }

    // Handle reference image selection
    function handleRefImageChange(e: React.ChangeEvent<HTMLInputElement>) {
        const files = e.target.files
        if (files && files.length > 0) {
            const newFiles: File[] = []
            const newPreviews: string[] = []

            for (let i = 0; i < files.length; i++) {
                const file = files[i]
                if (!file.type.startsWith('image/')) {
                    alert(`${file.name} is not an image file`)
                    continue
                }
                if (file.size > 10 * 1024 * 1024) {
                    alert(`${file.name} must be less than 10MB`)
                    continue
                }
                newFiles.push(file)
                newPreviews.push(URL.createObjectURL(file))
            }

            setRefImageFiles(prev => [...prev, ...newFiles])
            setRefImagePreviews(prev => [...prev, ...newPreviews])
        }
        // Reset input
        if (refImageInputRef.current) refImageInputRef.current.value = ''
    }

    // Remove a new reference image
    function removeRefImage(index: number) {
        URL.revokeObjectURL(refImagePreviews[index])
        setRefImageFiles(prev => prev.filter((_, i) => i !== index))
        setRefImagePreviews(prev => prev.filter((_, i) => i !== index))
    }

    // Remove an existing reference image
    function removeExistingRefImage(index: number) {
        setExistingRefImages(prev => prev.filter((_, i) => i !== index))
        setExistingRefImageUrls(prev => prev.filter((_, i) => i !== index))
    }

    // Upload reference images to storage
    async function uploadRefImages(files: File[], taskId: string): Promise<string[]> {
        const supabase = createUntypedClient()
        const uploadedUrls: string[] = []

        for (let i = 0; i < files.length; i++) {
            const file = files[i]
            const fileExt = file.name.split('.').pop()
            const fileName = `task_${taskId}_ref_${i}_${Date.now()}.${fileExt}`
            const filePath = `task-references/${taskId}/${fileName}`

            const { error } = await supabase.storage
                .from('task-media')
                .upload(filePath, file, { cacheControl: '3600', upsert: false })

            if (!error) {
                uploadedUrls.push(filePath)
            } else {
                console.warn(`Failed to upload reference image ${i}:`, error)
            }
        }

        return uploadedUrls
    }

    // Handle reference video selection
    function handleRefVideoChange(e: React.ChangeEvent<HTMLInputElement>) {
        const files = e.target.files
        if (files && files.length > 0) {
            const newFiles: File[] = []
            const newPreviews: string[] = []

            for (let i = 0; i < files.length; i++) {
                const file = files[i]
                if (!file.type.startsWith('video/')) {
                    alert(`${file.name} is not a video file`)
                    continue
                }
                // 10GB limit
                if (file.size > 10 * 1024 * 1024 * 1024) {
                    alert(`${file.name} must be less than 10GB`)
                    continue
                }
                newFiles.push(file)
                newPreviews.push(URL.createObjectURL(file))
            }

            setRefVideoFiles(prev => [...prev, ...newFiles])
            setRefVideoPreviews(prev => [...prev, ...newPreviews])
        }
        // Reset input
        if (refVideoInputRef.current) refVideoInputRef.current.value = ''
    }

    // Remove a new reference video
    function removeRefVideo(index: number) {
        URL.revokeObjectURL(refVideoPreviews[index])
        setRefVideoFiles(prev => prev.filter((_, i) => i !== index))
        setRefVideoPreviews(prev => prev.filter((_, i) => i !== index))
    }

    // Remove an existing reference video
    function removeExistingRefVideo(index: number) {
        setExistingRefVideos(prev => prev.filter((_, i) => i !== index))
        setExistingRefVideoUrls(prev => prev.filter((_, i) => i !== index))
    }

    // Format file size for display
    function formatFileSize(bytes: number): string {
        if (bytes < 1024) return bytes + ' B'
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
        if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
        return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
    }

    // Upload reference videos to storage (with progress tracking for large files)
    async function uploadRefVideos(files: File[], taskId: string): Promise<string[]> {
        const supabase = createUntypedClient()
        const uploadedUrls: string[] = []

        for (let i = 0; i < files.length; i++) {
            const file = files[i]
            const fileExt = file.name.split('.').pop()
            const fileName = `task_${taskId}_video_${i}_${Date.now()}.${fileExt}`
            const filePath = `task-references/${taskId}/${fileName}`

            setVideoUploadProgress(`Uploading video ${i + 1}/${files.length}: ${file.name} (${formatFileSize(file.size)})...`)

            const { error } = await supabase.storage
                .from('task-media')
                .upload(filePath, file, { cacheControl: '3600', upsert: false })

            if (!error) {
                uploadedUrls.push(filePath)
            } else {
                console.warn(`Failed to upload reference video ${i}:`, error)
                alert(`Failed to upload ${file.name}: ${error.message}`)
            }
        }

        setVideoUploadProgress('')
        return uploadedUrls
    }

    async function openTaskDetailModal(task: Task) {
        setViewingTask(task)
        setShowTaskDetailModal(true)
        setTaskDetailRefImageUrls([])
        setTaskDetailRefVideoUrls([])

        // Load signed URLs for reference images
        if (task.reference_images && task.reference_images.length > 0) {
            const signedUrls: string[] = []
            for (const path of task.reference_images) {
                const signed = await getSignedStorageUrl(path, 'task-media')
                if (signed) signedUrls.push(signed)
            }
            setTaskDetailRefImageUrls(signedUrls)
        }

        // Load signed URLs for reference videos
        if (task.reference_videos && task.reference_videos.length > 0) {
            const signedUrls: string[] = []
            for (const path of task.reference_videos) {
                const signed = await getSignedStorageUrl(path, 'task-media')
                if (signed) signedUrls.push(signed)
            }
            setTaskDetailRefVideoUrls(signedUrls)
        }
    }

    function closeTaskDetailModal() {
        setShowTaskDetailModal(false)
        setViewingTask(null)
        setTaskDetailRefImageUrls([])
        setTaskDetailRefVideoUrls([])
    }

    function openAssignModal(task: Task) {
        setAssigningTask(task)
        setAssignData({
            employee_id: '',
            scheduled_date: getTodayNY()
        })
        setShowAssignModal(true)
    }

    function closeAssignModal() {
        setShowAssignModal(false)
        setAssigningTask(null)
    }

    function openDetailModal(instance: TaskInstance) {
        setViewingInstance(instance)
        setShowDetailModal(true)
    }

    function closeDetailModal() {
        setShowDetailModal(false)
        setViewingInstance(null)
        setSignedPhotoUrls([])
        setSignedVideoUrls([])
        setSignedRefImageUrls([])
        setSignedRefVideoUrls([])
    }

    // Load signed URLs when viewing an instance
    useEffect(() => {
        async function loadSignedUrls() {
            if (viewingInstance) {
                // Load multiple photo URLs (employee submission)
                const photoUrls: string[] = []
                // First check photo_urls array
                if (viewingInstance.photo_urls && viewingInstance.photo_urls.length > 0) {
                    for (const url of viewingInstance.photo_urls) {
                        const signed = await getSignedStorageUrl(url, 'task-media')
                        if (signed) photoUrls.push(signed)
                    }
                }
                // Fallback to single photo_url for backward compatibility
                else if (viewingInstance.photo_url) {
                    const signed = await getSignedStorageUrl(viewingInstance.photo_url, 'task-media')
                    if (signed) photoUrls.push(signed)
                }
                setSignedPhotoUrls(photoUrls)

                // Load multiple video URLs (employee submission)
                const videoUrls: string[] = []
                // First check video_urls array
                if (viewingInstance.video_urls && viewingInstance.video_urls.length > 0) {
                    for (const url of viewingInstance.video_urls) {
                        const signed = await getSignedStorageUrl(url, 'task-media')
                        if (signed) videoUrls.push(signed)
                    }
                }
                // Fallback to single video_url for backward compatibility
                else if (viewingInstance.video_url) {
                    const signed = await getSignedStorageUrl(viewingInstance.video_url, 'task-media')
                    if (signed) videoUrls.push(signed)
                }
                setSignedVideoUrls(videoUrls)

                // Load reference images (from joined task data)
                const refImageUrls: string[] = []
                if (viewingInstance.tasks?.reference_images && viewingInstance.tasks.reference_images.length > 0) {
                    for (const url of viewingInstance.tasks.reference_images) {
                        const signed = await getSignedStorageUrl(url, 'task-media')
                        if (signed) refImageUrls.push(signed)
                    }
                }
                setSignedRefImageUrls(refImageUrls)

                // Load reference videos (from joined task data)
                const refVideoUrls: string[] = []
                if (viewingInstance.tasks?.reference_videos && viewingInstance.tasks.reference_videos.length > 0) {
                    for (const url of viewingInstance.tasks.reference_videos) {
                        const signed = await getSignedStorageUrl(url, 'task-media')
                        if (signed) refVideoUrls.push(signed)
                    }
                }
                setSignedRefVideoUrls(refVideoUrls)
            }
        }
        loadSignedUrls()
    }, [viewingInstance])

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()

        // Validate assignment fields if assign_now is checked
        if (formData.assign_now && !formData.employee_id) {
            alert('Please select an employee to assign the task to')
            return
        }

        setSaving(true)
        try {
            const supabase = createUntypedClient()
            let taskId: string | null = editingTask?.id || null

            // For new tasks, create first to get the ID for image uploads
            if (!editingTask) {
                const { data, error } = await supabase
                    .from('tasks')
                    .insert({
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
                    })
                    .select('id')
                    .single()
                if (error) throw error
                taskId = data?.id
            }

            // Upload new reference images if any
            let allRefImages = [...existingRefImages]
            if (refImageFiles.length > 0 && taskId) {
                const newRefUrls = await uploadRefImages(refImageFiles, taskId)
                allRefImages = [...allRefImages, ...newRefUrls]
            }

            // Upload new reference videos if any
            let allRefVideos = [...existingRefVideos]
            if (refVideoFiles.length > 0 && taskId) {
                const newVideoUrls = await uploadRefVideos(refVideoFiles, taskId)
                allRefVideos = [...allRefVideos, ...newVideoUrls]
            }

            // Build task data with reference images and videos
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
                reference_images: allRefImages.length > 0 ? allRefImages : null,
                reference_videos: allRefVideos.length > 0 ? allRefVideos : null,
                created_by: user?.id
            }

            if (editingTask) {
                const { error } = await supabase
                    .from('tasks')
                    .update(taskData)
                    .eq('id', editingTask.id)
                if (error) throw error
            } else if (taskId) {
                // Update the just-created task with reference images and videos
                const { error } = await supabase
                    .from('tasks')
                    .update({
                        reference_images: allRefImages.length > 0 ? allRefImages : null,
                        reference_videos: allRefVideos.length > 0 ? allRefVideos : null
                    })
                    .eq('id', taskId)
                if (error) throw error
            }

            // If assign_now is checked, create the task instance
            if (formData.assign_now && taskId && formData.employee_id) {
                const { data: instanceData, error: instanceError } = await supabase
                    .from('task_instances')
                    .insert({
                        task_id: taskId,
                        employee_id: formData.employee_id,
                        scheduled_date: formData.scheduled_date,
                        status: 'pending'
                    })
                    .select()
                    .single()

                if (instanceError) throw instanceError

                // Send notification
                if (instanceData?.id) {
                    taskNotifications.assigned(instanceData.id).catch(console.error)
                }

                alert(editingTask ? 'Task updated and assigned!' : 'Task created and assigned!')
                mutateInstances()
            } else {
                alert(editingTask ? 'Task updated!' : 'Task created!')
            }

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

            const { data, error } = await supabase
                .from('task_instances')
                .insert({
                    task_id: assigningTask.id,
                    employee_id: assignData.employee_id,
                    scheduled_date: assignData.scheduled_date,
                    status: 'pending'
                })
                .select()
                .single()

            if (error) throw error

            // Send email notification to assigned employee (non-blocking)
            if (data?.id) {
                taskNotifications.assigned(data.id).catch(console.error)
            }

            alert('Task assigned successfully!')
            closeAssignModal()
            mutateInstances()
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

    async function updateInstanceStatus(instanceId: string, newStatus: string) {
        try {
            const supabase = createUntypedClient()
            const updateData: Record<string, unknown> = { status: newStatus }

            if (newStatus === 'completed') {
                updateData.completed_at = new Date().toISOString()
            }

            const { error } = await supabase
                .from('task_instances')
                .update(updateData)
                .eq('id', instanceId)

            if (error) throw error
            mutateInstances()
        } catch (err) {
            console.error('Error updating task status:', err)
            alert('Failed to update task status')
        }
    }

    async function deleteInstance(instanceId: string) {
        if (!confirm('Are you sure you want to delete this assigned task?')) return
        try {
            const supabase = createUntypedClient()
            const { error } = await supabase
                .from('task_instances')
                .delete()
                .eq('id', instanceId)
            if (error) throw error
            mutateInstances()
        } catch (err) {
            console.error('Error deleting task instance:', err)
            alert('Failed to delete assigned task')
        }
    }

    // Multi-select functions
    function toggleTaskSelection(taskId: string) {
        setSelectedTaskIds(prev => {
            const newSet = new Set(prev)
            if (newSet.has(taskId)) {
                newSet.delete(taskId)
            } else {
                newSet.add(taskId)
            }
            return newSet
        })
    }

    function toggleSelectAllTasks() {
        if (selectedTaskIds.size === filteredTasks.length) {
            setSelectedTaskIds(new Set())
        } else {
            setSelectedTaskIds(new Set(filteredTasks.map((t: Task) => t.id)))
        }
    }

    function clearSelection() {
        setSelectedTaskIds(new Set())
    }

    async function bulkDeleteTasks() {
        if (selectedTaskIds.size === 0) return
        if (!confirm(`Are you sure you want to delete ${selectedTaskIds.size} task(s)? This action cannot be undone.`)) return

        setSaving(true)
        try {
            const supabase = createUntypedClient()
            const ids = Array.from(selectedTaskIds)

            const { error } = await supabase
                .from('tasks')
                .delete()
                .in('id', ids)

            if (error) throw error

            alert(`Successfully deleted ${ids.length} task(s)`)
            clearSelection()
            invalidateQueries.tasks()
            mutate()
        } catch (err) {
            console.error('Error bulk deleting tasks:', err)
            alert('Failed to delete some tasks')
        } finally {
            setSaving(false)
        }
    }

    function openBulkAssignModal() {
        if (selectedTaskIds.size === 0) return
        setBulkAssignData({
            employee_id: '',
            scheduled_date: getTodayNY()
        })
        setShowBulkAssignModal(true)
    }

    function closeBulkAssignModal() {
        setShowBulkAssignModal(false)
    }

    async function handleBulkAssign(e: React.FormEvent) {
        e.preventDefault()
        if (selectedTaskIds.size === 0 || !bulkAssignData.employee_id) return

        setSaving(true)
        try {
            const supabase = createUntypedClient()
            const taskIds = Array.from(selectedTaskIds)

            // Create task instances for each selected task
            const instances = taskIds.map(taskId => ({
                task_id: taskId,
                employee_id: bulkAssignData.employee_id,
                scheduled_date: bulkAssignData.scheduled_date,
                status: 'pending'
            }))

            const { data, error } = await supabase
                .from('task_instances')
                .insert(instances)
                .select()

            if (error) throw error

            // Send notifications for each created instance
            if (data && data.length > 0) {
                for (const instance of data) {
                    taskNotifications.assigned(instance.id).catch(console.error)
                }
            }

            alert(`Successfully assigned ${taskIds.length} task(s)`)
            closeBulkAssignModal()
            clearSelection()
            mutateInstances()
            setActiveTab('assigned') // Switch to assigned tab to show the newly assigned tasks
        } catch (err: unknown) {
            const error = err as Error
            console.error('Error bulk assigning tasks:', error)
            alert('Error: ' + error.message)
        } finally {
            setSaving(false)
        }
    }

    // Stats for assigned tasks (based on API-filtered results before client-side filters)
    const stats = useMemo(() => {
        const pending = taskInstances.filter((t: TaskInstance) => t.status === 'pending').length
        const completed = taskInstances.filter((t: TaskInstance) => t.status === 'completed').length
        const overdue = taskInstances.filter((t: TaskInstance) => t.status === 'overdue').length
        return { pending, completed, overdue, total: taskInstances.length }
    }, [taskInstances])

    // Apply client-side filters for status, taskId, location, and hasSubmission
    const filteredTaskInstances = useMemo(() => {
        return taskInstances.filter((instance: TaskInstance) => {
            // Filter by status (applied client-side to keep stats accurate)
            if (filters.status !== 'all' && instance.status !== filters.status) {
                return false
            }
            // Filter by task ID
            if (filters.taskId !== 'all' && instance.task_id !== filters.taskId) {
                return false
            }
            // Filter by location
            if (filters.location !== 'all' && instance.tasks?.location !== filters.location) {
                return false
            }
            // Filter by submission status
            if (filters.hasSubmission !== 'all') {
                const hasPhotos = instance.photo_url || (instance.photo_urls && instance.photo_urls.length > 0)
                const hasAnySubmission = instance.notes || hasPhotos || instance.video_url
                switch (filters.hasSubmission) {
                    case 'with':
                        if (!hasAnySubmission) return false
                        break
                    case 'without':
                        if (hasAnySubmission) return false
                        break
                    case 'photo':
                        if (!hasPhotos) return false
                        break
                    case 'video':
                        if (!instance.video_url) return false
                        break
                    case 'notes':
                        if (!instance.notes) return false
                        break
                }
            }
            return true
        })
    }, [taskInstances, filters.status, filters.taskId, filters.location, filters.hasSubmission])

    return (
        <div className="space-y-4 sm:space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold">Tasks</h1>
                    <p className="text-muted-foreground mt-1 text-sm sm:text-base">
                        Manage task definitions and assignments
                    </p>
                </div>
                <div className="flex gap-2">
                    <button className="btn-secondary" onClick={() => { setActiveTab('definitions'); openModal(); }}>
                        + Create Task
                    </button>
                    <button className="btn-primary" onClick={() => setActiveTab('assigned')}>
                        View Assigned
                    </button>
                </div>
            </div>

            {/* Filters - Always visible */}
            <div className="card p-4">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium text-muted-foreground">Filters</h3>
                    {(filters.status !== 'all' || filters.employeeId !== 'all' || filters.taskId !== 'all' || filters.location !== 'all' || filters.hasSubmission !== 'all') && (
                        <button
                            className="text-xs text-primary hover:underline"
                            onClick={clearFilters}
                        >
                            Clear all filters
                        </button>
                    )}
                </div>
                <div className="overflow-x-auto pb-2">
                    <div className="flex gap-4" style={{ minWidth: '600px' }}>
                        <div className="flex-1">
                            <label className="label">Start Date</label>
                            <input
                                type="date"
                                className="input"
                                value={filters.startDate}
                                onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                            />
                        </div>
                        <div className="flex-1">
                            <label className="label">End Date</label>
                            <input
                                type="date"
                                className="input"
                                value={filters.endDate}
                                onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
                            />
                        </div>
                        <div className="flex-1">
                            <label className="label">Status</label>
                            <select
                                className="input"
                                value={filters.status}
                                onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                            >
                                <option value="all">All Statuses</option>
                                <option value="pending">Pending</option>
                                <option value="completed">Completed</option>
                                <option value="overdue">Overdue</option>
                            </select>
                        </div>
                        <div className="flex-1">
                            <label className="label">Employee</label>
                            <select
                                className="input"
                                value={filters.employeeId}
                                onChange={(e) => setFilters({ ...filters, employeeId: e.target.value })}
                            >
                                <option value="all">All Employees</option>
                                {employees.map((emp: ActiveEmployee) => (
                                    <option key={emp.id} value={emp.id}>
                                        {emp.display_name || 'Unnamed'}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>
                <div className="overflow-x-auto pb-2 mt-4">
                    <div className="flex gap-4" style={{ minWidth: '600px' }}>
                        <div className="flex-1">
                            <label className="label">Task</label>
                            <select
                                className="input"
                                value={filters.taskId}
                                onChange={(e) => setFilters({ ...filters, taskId: e.target.value })}
                            >
                                <option value="all">All Tasks</option>
                                {tasks.map((task: Task) => (
                                    <option key={task.id} value={task.id}>
                                        {task.title}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="flex-1">
                            <label className="label">Location</label>
                            <select
                                className="input"
                                value={filters.location}
                                onChange={(e) => setFilters({ ...filters, location: e.target.value })}
                            >
                                <option value="all">All Locations</option>
                                {uniqueLocations.map((loc: string) => (
                                    <option key={loc} value={loc}>
                                        {loc}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="flex-1">
                            <label className="label">Submission</label>
                            <select
                                className="input"
                                value={filters.hasSubmission}
                                onChange={(e) => setFilters({ ...filters, hasSubmission: e.target.value })}
                            >
                                <option value="all">All</option>
                                <option value="with">With Submissions</option>
                                <option value="without">Without Submissions</option>
                                <option value="photo">Has Photo</option>
                                <option value="video">Has Video</option>
                                <option value="notes">Has Notes</option>
                            </select>
                        </div>
                        <div className="flex-1 flex items-end">
                            <button className="btn-secondary w-full" onClick={() => mutateInstances()}>
                                Refresh
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 border-b">
                <button
                    className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
                        activeTab === 'assigned'
                            ? 'border-primary text-primary'
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                    onClick={() => setActiveTab('assigned')}
                >
                    Tasks Assigned to Employees ({stats.total})
                </button>
                <button
                    className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
                        activeTab === 'definitions'
                            ? 'border-primary text-primary'
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                    onClick={() => setActiveTab('definitions')}
                >
                    Assign Task to Employee ({tasks.length})
                </button>
            </div>

            {/* Assigned Tasks Tab */}
            {activeTab === 'assigned' && (
                <div className="space-y-4">
                    {/* Stats Cards - Clickable to filter */}
                    <div className="overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 sm:overflow-visible">
                        <div className="flex gap-3 min-w-max sm:grid sm:grid-cols-4 sm:gap-4 sm:min-w-0">
                            <button
                                onClick={() => handleStatCardClick('all')}
                                className={`card p-3 sm:p-4 text-left transition-all hover:shadow-md hover:scale-[1.02] cursor-pointer min-w-[120px] sm:min-w-0 ${
                                    filters.status === 'all' ? 'ring-2 ring-primary ring-offset-2' : ''
                                }`}
                            >
                                <p className="text-xs sm:text-sm text-muted-foreground">Total Assigned</p>
                                <p className="text-xl sm:text-2xl font-bold">{stats.total}</p>
                            </button>
                            <button
                                onClick={() => handleStatCardClick('pending')}
                                className={`card p-3 sm:p-4 text-left transition-all hover:shadow-md hover:scale-[1.02] cursor-pointer min-w-[120px] sm:min-w-0 ${
                                    filters.status === 'pending' ? 'ring-2 ring-yellow-500 ring-offset-2' : ''
                                }`}
                            >
                                <p className="text-xs sm:text-sm text-muted-foreground">Pending</p>
                                <p className="text-xl sm:text-2xl font-bold text-yellow-600">{stats.pending}</p>
                            </button>
                            <button
                                onClick={() => handleStatCardClick('completed')}
                                className={`card p-3 sm:p-4 text-left transition-all hover:shadow-md hover:scale-[1.02] cursor-pointer min-w-[120px] sm:min-w-0 ${
                                    filters.status === 'completed' ? 'ring-2 ring-green-500 ring-offset-2' : ''
                                }`}
                            >
                                <p className="text-xs sm:text-sm text-muted-foreground">Completed</p>
                                <p className="text-xl sm:text-2xl font-bold text-green-600">{stats.completed}</p>
                            </button>
                            <button
                                onClick={() => handleStatCardClick('overdue')}
                                className={`card p-3 sm:p-4 text-left transition-all hover:shadow-md hover:scale-[1.02] cursor-pointer min-w-[120px] sm:min-w-0 ${
                                    filters.status === 'overdue' ? 'ring-2 ring-red-500 ring-offset-2' : ''
                                }`}
                            >
                                <p className="text-xs sm:text-sm text-muted-foreground">Overdue</p>
                                <p className="text-xl sm:text-2xl font-bold text-red-600">{stats.overdue}</p>
                            </button>
                        </div>
                    </div>

                    {/* Assigned Tasks Table */}
                    {instancesLoading ? (
                        <div className="space-y-3">
                            {[...Array(5)].map((_, i) => (
                                <div key={i} className="h-16 bg-muted rounded-lg animate-pulse"></div>
                            ))}
                        </div>
                    ) : filteredTaskInstances.length === 0 ? (
                        <div className="card p-6 sm:p-8 text-center">
                            <p className="text-muted-foreground mb-4">
                                {taskInstances.length === 0
                                    ? 'No assigned tasks found'
                                    : 'No tasks match the selected filters'}
                            </p>
                            {taskInstances.length > 0 ? (
                                <button className="btn-secondary" onClick={clearFilters}>
                                    Clear Filters
                                </button>
                            ) : (
                                <button className="btn-primary" onClick={() => setActiveTab('definitions')}>
                                    Go to Assign Task to Employee
                                </button>
                            )}
                        </div>
                    ) : (
                        <div className="card overflow-hidden">
                            {/* Results count */}
                            {filteredTaskInstances.length !== taskInstances.length && (
                                <div className="px-4 py-2 bg-muted/50 border-b text-sm text-muted-foreground">
                                    Showing {filteredTaskInstances.length} of {taskInstances.length} tasks
                                </div>
                            )}
                            <div className="scrollbar-visible">
                                <table className="w-full text-sm" style={{ minWidth: '1100px' }}>
                                    <thead className="bg-muted/50">
                                        <tr>
                                            <th className="text-left p-3 font-medium whitespace-nowrap">Task</th>
                                            <th className="text-left p-3 font-medium whitespace-nowrap">Employee</th>
                                            <th className="text-center p-3 font-medium whitespace-nowrap">Recurring</th>
                                            <th className="text-left p-3 font-medium whitespace-nowrap">Created At</th>
                                            <th className="text-left p-3 font-medium whitespace-nowrap">Status</th>
                                            <th className="text-left p-3 font-medium whitespace-nowrap">Location</th>
                                            <th className="text-left p-3 font-medium whitespace-nowrap">Requirements</th>
                                            <th className="text-left p-3 font-medium whitespace-nowrap">Scheduled Date</th>
                                            <th className="text-left p-3 font-medium whitespace-nowrap">Completed At</th>
                                            <th className="text-left p-3 font-medium whitespace-nowrap">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y">
                                        {filteredTaskInstances.map((instance: TaskInstance) => (
                                            <tr
                                                key={instance.id}
                                                className="hover:bg-muted/30 cursor-pointer transition-colors"
                                                onClick={() => openDetailModal(instance)}
                                            >
                                                <td className="p-3">
                                                    <div className="font-medium flex items-center gap-2">
                                                        {instance.tasks?.title || 'Unknown Task'}
                                                        {(instance.notes || instance.photo_url || (instance.photo_urls && instance.photo_urls.length > 0) || instance.video_url || (instance.video_urls && instance.video_urls.length > 0)) && (
                                                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium bg-blue-100 text-blue-700 rounded">
                                                                {(instance.photo_url || (instance.photo_urls && instance.photo_urls.length > 0)) && `📷${instance.photo_urls && instance.photo_urls.length > 1 ? instance.photo_urls.length : ''}`}
                                                                {(instance.video_url || (instance.video_urls && instance.video_urls.length > 0)) && `🎥${instance.video_urls && instance.video_urls.length > 1 ? instance.video_urls.length : ''}`}
                                                                {instance.notes && '📝'}
                                                            </span>
                                                        )}
                                                    </div>
                                                    {instance.tasks?.description && (
                                                        <div className="text-xs text-muted-foreground line-clamp-1">{instance.tasks.description.replace(/<[^>]*>/g, ' ').replace(/&[^;]+;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) + '...'}</div>
                                                    )}
                                                </td>
                                                <td className="p-3">
                                                    <div className="font-medium">
                                                        {instance.employees?.display_name || instance.employees?.profiles?.full_name || 'Unknown'}
                                                    </div>
                                                    <div className="text-xs text-muted-foreground">
                                                        {instance.employees?.position || instance.employees?.profiles?.email || '-'}
                                                    </div>
                                                </td>
                                                <td className="p-3 text-center">
                                                    {instance.tasks?.is_recurring ? (
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded-full">
                                                            Yes
                                                            {instance.tasks.frequency && <span className="text-blue-500 capitalize">({instance.tasks.frequency})</span>}
                                                        </span>
                                                    ) : (
                                                        <span className="text-xs text-muted-foreground">No</span>
                                                    )}
                                                </td>
                                                <td className="p-3 text-muted-foreground whitespace-nowrap text-xs">
                                                    {formatDateTime(instance.created_at)}
                                                </td>
                                                <td className="p-3">
                                                    <select
                                                        className={`text-xs px-2 py-1 rounded-full font-medium border-0 cursor-pointer ${
                                                            instance.status === 'completed' ? 'bg-green-100 text-green-800' :
                                                            instance.status === 'overdue' ? 'bg-red-100 text-red-800' :
                                                            'bg-yellow-100 text-yellow-800'
                                                        }`}
                                                        value={instance.status}
                                                        onClick={(e) => e.stopPropagation()}
                                                        onChange={(e) => updateInstanceStatus(instance.id, e.target.value)}
                                                    >
                                                        <option value="pending">Pending</option>
                                                        <option value="completed">Completed</option>
                                                        <option value="overdue">Overdue</option>
                                                    </select>
                                                </td>
                                                <td className="p-3 text-muted-foreground">
                                                    {instance.tasks?.location || '-'}
                                                </td>
                                                <td className="p-3">
                                                    <div className="flex gap-1">
                                                        {instance.tasks?.requires_photo && (
                                                            <span className="text-xs" title="Photo required">📷</span>
                                                        )}
                                                        {instance.tasks?.requires_video && (
                                                            <span className="text-xs" title="Video required">🎥</span>
                                                        )}
                                                        {instance.tasks?.requires_notes && (
                                                            <span className="text-xs" title="Notes required">📝</span>
                                                        )}
                                                        {!instance.tasks?.requires_photo && !instance.tasks?.requires_video && !instance.tasks?.requires_notes && (
                                                            <span className="text-muted-foreground">-</span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="p-3 whitespace-nowrap">
                                                    {formatScheduleDate(instance.scheduled_date)}
                                                </td>
                                                <td className="p-3 text-muted-foreground whitespace-nowrap">
                                                    {instance.completed_at
                                                        ? new Date(instance.completed_at).toLocaleString('en-US', {
                                                            timeZone: 'America/New_York',
                                                            month: 'short',
                                                            day: 'numeric',
                                                            hour: '2-digit',
                                                            minute: '2-digit'
                                                        })
                                                        : '-'}
                                                </td>
                                                <td className="p-3">
                                                    <div className="flex gap-2">
                                                        <button
                                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 hover:border-blue-300 transition-colors"
                                                            onClick={(e) => { e.stopPropagation(); openDetailModal(instance); }}
                                                            title="View details"
                                                        >
                                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                                            </svg>
                                                            View
                                                        </button>
                                                        <button
                                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 hover:border-red-300 transition-colors"
                                                            onClick={(e) => { e.stopPropagation(); deleteInstance(instance.id); }}
                                                            title="Delete assigned task"
                                                        >
                                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                            </svg>
                                                            Delete
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Task Definitions Tab */}
            {activeTab === 'definitions' && (
                <div className="space-y-4">
                    {/* Definition Filters */}
                    <div className="card p-4">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-sm font-medium text-muted-foreground">Filter Tasks</h3>
                            {hasActiveDefinitionFilters && (
                                <button
                                    className="text-xs text-primary hover:underline"
                                    onClick={clearDefinitionFilters}
                                >
                                    Clear all filters
                                </button>
                            )}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                            <div>
                                <label className="label">Search</label>
                                <input
                                    type="text"
                                    className="input"
                                    placeholder="Search by title..."
                                    value={definitionFilters.search}
                                    onChange={(e) => setDefinitionFilters({ ...definitionFilters, search: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="label">Location</label>
                                <select
                                    className="input"
                                    value={definitionFilters.location}
                                    onChange={(e) => setDefinitionFilters({ ...definitionFilters, location: e.target.value })}
                                >
                                    <option value="all">All Locations</option>
                                    {uniqueTaskLocations.map((loc: string) => (
                                        <option key={loc} value={loc}>
                                            {loc}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="label">Role Target</label>
                                <select
                                    className="input"
                                    value={definitionFilters.roleTarget}
                                    onChange={(e) => setDefinitionFilters({ ...definitionFilters, roleTarget: e.target.value })}
                                >
                                    <option value="all">All Roles</option>
                                    <option value="all">All Staff</option>
                                    <option value="employee">Employees Only</option>
                                    <option value="admin">Admins Only</option>
                                </select>
                            </div>
                            <div>
                                <label className="label">Recurring</label>
                                <select
                                    className="input"
                                    value={definitionFilters.recurring}
                                    onChange={(e) => setDefinitionFilters({ ...definitionFilters, recurring: e.target.value })}
                                >
                                    <option value="all">All</option>
                                    <option value="yes">Recurring Only</option>
                                    <option value="no">One-time Only</option>
                                </select>
                            </div>
                            <div>
                                <label className="label">Requirements</label>
                                <select
                                    className="input"
                                    value={definitionFilters.requirement}
                                    onChange={(e) => setDefinitionFilters({ ...definitionFilters, requirement: e.target.value })}
                                >
                                    <option value="all">All</option>
                                    <option value="any">Has Any Requirement</option>
                                    <option value="none">No Requirements</option>
                                    <option value="photo">Requires Photo</option>
                                    <option value="video">Requires Video</option>
                                    <option value="notes">Requires Notes</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Results count */}
                    {hasActiveDefinitionFilters && filteredTasks.length !== tasks.length && (
                        <div className="text-sm text-muted-foreground">
                            Showing {filteredTasks.length} of {tasks.length} tasks
                        </div>
                    )}

                    {loading ? (
                        <div className="card">
                            <div className="p-4 space-y-3">
                                {[...Array(5)].map((_, i) => (
                                    <div key={i} className="h-12 bg-muted rounded animate-pulse"></div>
                                ))}
                            </div>
                        </div>
                    ) : tasks.length === 0 ? (
                        <div className="card p-6 sm:p-8 text-center">
                            <p className="text-muted-foreground mb-4 text-sm sm:text-base">No tasks created yet</p>
                            <button className="btn-primary" onClick={() => openModal()}>
                                Create Your First Task
                            </button>
                        </div>
                    ) : filteredTasks.length === 0 ? (
                        <div className="card p-6 sm:p-8 text-center">
                            <p className="text-muted-foreground mb-4 text-sm sm:text-base">No tasks match the selected filters</p>
                            <button className="btn-secondary" onClick={clearDefinitionFilters}>
                                Clear Filters
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {/* Bulk Actions Bar */}
                            {selectedTaskIds.size > 0 && (
                                <div className="card p-3 bg-primary/5 border-primary/20 flex flex-wrap items-center justify-between gap-3">
                                    <div className="flex items-center gap-3">
                                        <span className="text-sm font-medium">
                                            {selectedTaskIds.size} task{selectedTaskIds.size > 1 ? 's' : ''} selected
                                        </span>
                                        <button
                                            className="text-sm text-primary hover:underline"
                                            onClick={clearSelection}
                                        >
                                            Clear selection
                                        </button>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-green-700 bg-green-50 border border-green-200 rounded-md hover:bg-green-100 hover:border-green-300 transition-colors"
                                            onClick={openBulkAssignModal}
                                            disabled={saving}
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                                            </svg>
                                            Assign ({selectedTaskIds.size})
                                        </button>
                                        <button
                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 hover:border-red-300 transition-colors"
                                            onClick={bulkDeleteTasks}
                                            disabled={saving}
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                            </svg>
                                            Delete ({selectedTaskIds.size})
                                        </button>
                                    </div>
                                </div>
                            )}

                            <div className="card overflow-hidden">
                                <div className="overflow-x-auto">
                                    <table className="w-full">
                                        <thead className="bg-muted/50">
                                            <tr>
                                                <th className="w-10 p-3" onClick={(e) => e.stopPropagation()}>
                                                    <input
                                                        type="checkbox"
                                                        className="rounded border-gray-300 cursor-pointer"
                                                        checked={selectedTaskIds.size === filteredTasks.length && filteredTasks.length > 0}
                                                        onChange={toggleSelectAllTasks}
                                                        title="Select all"
                                                    />
                                                </th>
                                                <th className="text-left p-3 text-xs font-medium text-muted-foreground">Task Title</th>
                                                <th className="text-left p-3 text-xs font-medium text-muted-foreground hidden sm:table-cell">Role</th>
                                                <th className="text-left p-3 text-xs font-medium text-muted-foreground hidden md:table-cell">Location</th>
                                                <th className="text-left p-3 text-xs font-medium text-muted-foreground hidden lg:table-cell">Cutoff</th>
                                                <th className="text-center p-3 text-xs font-medium text-muted-foreground">Requirements</th>
                                                <th className="text-left p-3 text-xs font-medium text-muted-foreground hidden lg:table-cell">Created</th>
                                                <th className="text-right p-3 text-xs font-medium text-muted-foreground">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y">
                                            {filteredTasks.map((task: Task) => (
                                                <tr
                                                    key={task.id}
                                                    className={`hover:bg-muted/30 cursor-pointer transition-colors ${selectedTaskIds.has(task.id) ? 'bg-primary/5' : ''}`}
                                                    onClick={() => openTaskDetailModal(task)}
                                                >
                                                    <td className="p-3" onClick={(e) => e.stopPropagation()}>
                                                        <input
                                                            type="checkbox"
                                                            className="rounded border-gray-300 cursor-pointer"
                                                            checked={selectedTaskIds.has(task.id)}
                                                            onChange={() => toggleTaskSelection(task.id)}
                                                        />
                                                    </td>
                                                    <td className="p-3">
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-medium text-sm">{task.title}</span>
                                                            {task.is_recurring && (
                                                                <span className="badge-default text-xs">🔄 {task.frequency}</span>
                                                            )}
                                                        </div>
                                                        {task.description && (
                                                            <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{task.description.replace(/<[^>]*>/g, ' ').replace(/&[^;]+;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)}</p>
                                                        )}
                                                    </td>
                                                <td className="p-3 text-sm hidden sm:table-cell">
                                                    {task.role_target ? (
                                                        <span className="badge-outline text-xs">{task.role_target}</span>
                                                    ) : (
                                                        <span className="text-muted-foreground text-xs">All</span>
                                                    )}
                                                </td>
                                                <td className="p-3 text-sm text-muted-foreground hidden md:table-cell">
                                                    {task.location || '—'}
                                                </td>
                                                <td className="p-3 text-sm text-muted-foreground hidden lg:table-cell">
                                                    {task.cutoff_time ? formatTimeString(task.cutoff_time) : '—'}
                                                </td>
                                                <td className="p-3">
                                                    <div className="flex justify-center gap-1 flex-wrap">
                                                        {task.requires_photo && <span className="text-xs" title="Photo required">📷</span>}
                                                        {task.requires_video && <span className="text-xs" title="Video required">🎥</span>}
                                                        {task.requires_notes && <span className="text-xs" title="Notes required">📝</span>}
                                                        {task.reference_images && task.reference_images.length > 0 && (
                                                            <span className="text-xs" title={`${task.reference_images.length} reference images`}>🖼️{task.reference_images.length}</span>
                                                        )}
                                                        {task.reference_videos && task.reference_videos.length > 0 && (
                                                            <span className="text-xs" title={`${task.reference_videos.length} reference videos`}>🎬{task.reference_videos.length}</span>
                                                        )}
                                                        {!task.requires_photo && !task.requires_video && !task.requires_notes && !task.reference_images?.length && !task.reference_videos?.length && (
                                                            <span className="text-xs text-muted-foreground">—</span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="p-3 text-xs text-muted-foreground hidden lg:table-cell whitespace-nowrap">
                                                    {formatDateTime(task.created_at)}
                                                </td>
                                                <td className="p-3" onClick={(e) => e.stopPropagation()}>
                                                    <div className="flex justify-end gap-2">
                                                        <button
                                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 hover:border-blue-300 transition-colors"
                                                            onClick={() => openTaskDetailModal(task)}
                                                            title="View task details"
                                                        >
                                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                                            </svg>
                                                            View
                                                        </button>
                                                        <button
                                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-50 border border-gray-200 rounded-md hover:bg-gray-100 hover:border-gray-300 transition-colors"
                                                            onClick={() => openModal(task)}
                                                            title="Edit task"
                                                        >
                                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                                            </svg>
                                                            Edit
                                                        </button>
                                                        <button
                                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-green-700 bg-green-50 border border-green-200 rounded-md hover:bg-green-100 hover:border-green-300 transition-colors"
                                                            onClick={() => openAssignModal(task)}
                                                            title="Assign task"
                                                        >
                                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                                                            </svg>
                                                            Assign
                                                        </button>
                                                        <button
                                                            className="inline-flex items-center justify-center w-8 h-8 text-red-600 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 hover:border-red-300 transition-colors"
                                                            onClick={() => deleteTask(task.id)}
                                                            title="Delete task"
                                                        >
                                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                            </svg>
                                                        </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Bulk Assign Modal */}
            {showBulkAssignModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-card rounded-lg shadow-lg w-full max-w-md">
                        <div className="p-6">
                            <h2 className="text-xl font-bold mb-2">Assign Tasks</h2>
                            <p className="text-muted-foreground mb-4">
                                Assign {selectedTaskIds.size} task{selectedTaskIds.size > 1 ? 's' : ''} to an employee
                            </p>
                            <form onSubmit={handleBulkAssign} className="space-y-4">
                                <div>
                                    <label className="label">Employee *</label>
                                    <select
                                        required
                                        className="input"
                                        value={bulkAssignData.employee_id}
                                        onChange={(e) => setBulkAssignData({ ...bulkAssignData, employee_id: e.target.value })}
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
                                        value={bulkAssignData.scheduled_date}
                                        onChange={(e) => setBulkAssignData({ ...bulkAssignData, scheduled_date: e.target.value })}
                                    />
                                </div>
                                <div className="bg-muted/50 rounded-lg p-3">
                                    <p className="text-sm font-medium mb-2">Selected Tasks:</p>
                                    <ul className="text-sm text-muted-foreground space-y-1 max-h-32 overflow-y-auto">
                                        {Array.from(selectedTaskIds).map(id => {
                                            const task = tasks.find((t: Task) => t.id === id)
                                            return task ? (
                                                <li key={id} className="truncate">• {task.title}</li>
                                            ) : null
                                        })}
                                    </ul>
                                </div>
                                <div className="flex gap-3 pt-4">
                                    <button
                                        type="button"
                                        className="btn-secondary flex-1"
                                        onClick={closeBulkAssignModal}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        className="btn-primary flex-1"
                                        disabled={saving}
                                    >
                                        {saving ? 'Assigning...' : `Assign ${selectedTaskIds.size} Task${selectedTaskIds.size > 1 ? 's' : ''}`}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
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
                                    <RichTextEditor
                                        value={formData.description}
                                        onChange={(value) => setFormData({ ...formData, description: value })}
                                        placeholder="Enter task description..."
                                        minHeight="80px"
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
                                <div className="grid grid-cols-3 gap-4">
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
                                        <label className="label">Due Date</label>
                                        <input
                                            type="date"
                                            className="input"
                                            value={formData.scheduled_date}
                                            onChange={(e) => setFormData({ ...formData, scheduled_date: e.target.value })}
                                        />
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

                                {/* Reference Images Section */}
                                <div className="space-y-2">
                                    <p className="label">
                                        Reference Images
                                        <span className="text-xs text-muted-foreground ml-2">
                                            ({existingRefImageUrls.length + refImagePreviews.length} added)
                                        </span>
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        Add example images to show employees what the completed task should look like
                                    </p>
                                    <input
                                        ref={refImageInputRef}
                                        type="file"
                                        accept="image/*"
                                        multiple
                                        onChange={handleRefImageChange}
                                        className="hidden"
                                    />
                                    {/* Existing images grid */}
                                    {existingRefImageUrls.length > 0 && (
                                        <div className="mb-2">
                                            <p className="text-xs text-muted-foreground mb-1">Current images:</p>
                                            <div className="grid grid-cols-4 gap-2">
                                                {existingRefImageUrls.map((url, index) => (
                                                    <div key={`existing-${index}`} className="relative aspect-square">
                                                        <img
                                                            src={url}
                                                            alt={`Reference ${index + 1}`}
                                                            className="w-full h-full object-cover rounded-lg border"
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() => removeExistingRefImage(index)}
                                                            className="absolute -top-1 -right-1 bg-destructive text-white rounded-full w-5 h-5 flex items-center justify-center text-xs shadow"
                                                        >
                                                            ✕
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    {/* New images grid */}
                                    {refImagePreviews.length > 0 && (
                                        <div className="mb-2">
                                            <p className="text-xs text-muted-foreground mb-1">New images to add:</p>
                                            <div className="grid grid-cols-4 gap-2">
                                                {refImagePreviews.map((preview, index) => (
                                                    <div key={`new-${index}`} className="relative aspect-square">
                                                        <img
                                                            src={preview}
                                                            alt={`New reference ${index + 1}`}
                                                            className="w-full h-full object-cover rounded-lg border border-primary"
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() => removeRefImage(index)}
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
                                        onClick={() => refImageInputRef.current?.click()}
                                        className="w-full h-14 border-2 border-dashed border-muted-foreground/25 rounded-lg hover:border-primary/50 transition-colors flex items-center justify-center gap-2 text-muted-foreground"
                                    >
                                        <span className="text-lg">📷</span>
                                        <span className="text-sm">Add reference images</span>
                                    </button>
                                </div>

                                {/* Reference Videos Section */}
                                <div>
                                    <p className="text-sm font-medium mb-1 flex items-center">
                                        Reference Videos (optional)
                                        {(existingRefVideoUrls.length > 0 || refVideoPreviews.length > 0) && (
                                            <span className="text-xs text-muted-foreground ml-2">
                                                ({existingRefVideoUrls.length + refVideoPreviews.length} added)
                                            </span>
                                        )}
                                    </p>
                                    <p className="text-xs text-muted-foreground mb-2">
                                        Add example videos to show employees how to complete the task (max 10GB per video)
                                    </p>
                                    <input
                                        ref={refVideoInputRef}
                                        type="file"
                                        accept="video/*"
                                        multiple
                                        onChange={handleRefVideoChange}
                                        className="hidden"
                                    />
                                    {/* Existing videos list */}
                                    {existingRefVideoUrls.length > 0 && (
                                        <div className="mb-2">
                                            <p className="text-xs text-muted-foreground mb-1">Current videos:</p>
                                            <div className="space-y-2">
                                                {existingRefVideoUrls.map((url, index) => (
                                                    <div key={`existing-video-${index}`} className="relative bg-muted/30 rounded-lg p-2 flex items-center gap-2">
                                                        <video
                                                            src={`${url}#t=0.1`}
                                                            className="w-20 h-14 object-cover rounded"
                                                            preload="metadata"
                                                            muted
                                                        />
                                                        <span className="text-sm flex-1 truncate">Video {index + 1}</span>
                                                        <button
                                                            type="button"
                                                            onClick={() => removeExistingRefVideo(index)}
                                                            className="bg-destructive text-white rounded-full w-6 h-6 flex items-center justify-center text-xs shadow flex-shrink-0"
                                                        >
                                                            ✕
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    {/* New videos list */}
                                    {refVideoPreviews.length > 0 && (
                                        <div className="mb-2">
                                            <p className="text-xs text-muted-foreground mb-1">New videos to add:</p>
                                            <div className="space-y-2">
                                                {refVideoPreviews.map((preview, index) => (
                                                    <div key={`new-video-${index}`} className="relative bg-muted/30 rounded-lg p-2 flex items-center gap-2 border border-primary">
                                                        <video
                                                            src={`${preview}#t=0.1`}
                                                            className="w-20 h-14 object-cover rounded"
                                                            preload="metadata"
                                                            muted
                                                        />
                                                        <div className="flex-1 min-w-0">
                                                            <span className="text-sm block truncate">{refVideoFiles[index]?.name}</span>
                                                            <span className="text-xs text-muted-foreground">{formatFileSize(refVideoFiles[index]?.size || 0)}</span>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => removeRefVideo(index)}
                                                            className="bg-destructive text-white rounded-full w-6 h-6 flex items-center justify-center text-xs shadow flex-shrink-0"
                                                        >
                                                            ✕
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    {videoUploadProgress && (
                                        <div className="mb-2 p-2 bg-primary/10 rounded-lg">
                                            <p className="text-xs text-primary">{videoUploadProgress}</p>
                                        </div>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => refVideoInputRef.current?.click()}
                                        className="w-full h-14 border-2 border-dashed border-muted-foreground/25 rounded-lg hover:border-primary/50 transition-colors flex items-center justify-center gap-2 text-muted-foreground"
                                    >
                                        <span className="text-lg">🎬</span>
                                        <span className="text-sm">Add reference videos</span>
                                    </button>
                                </div>

                                {/* Assignment Section */}
                                <div className="border-t pt-4 mt-4">
                                    <div className="flex items-center gap-2 mb-3">
                                        <input
                                            type="checkbox"
                                            id="assign_now"
                                            checked={formData.assign_now}
                                            onChange={(e) => setFormData({ ...formData, assign_now: e.target.checked })}
                                            className="rounded border-gray-300"
                                        />
                                        <label htmlFor="assign_now" className="text-sm font-medium">
                                            Assign to employee now
                                        </label>
                                    </div>
                                    {formData.assign_now && (
                                        <div className="bg-muted/30 p-4 rounded-lg">
                                            <div>
                                                <label className="label">Employee *</label>
                                                <select
                                                    className="input"
                                                    value={formData.employee_id}
                                                    onChange={(e) => setFormData({ ...formData, employee_id: e.target.value })}
                                                    required={formData.assign_now}
                                                >
                                                    <option value="">Select employee</option>
                                                    {employees.map((emp: ActiveEmployee) => (
                                                        <option key={emp.id} value={emp.id}>
                                                            {emp.display_name || 'Unnamed'} {emp.position ? `(${emp.position})` : ''}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                    )}
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

            {/* Task Instance Detail Modal */}
            {showDetailModal && viewingInstance && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-card rounded-lg shadow-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                        <div className="p-6">
                            {/* Header */}
                            <div className="flex items-start justify-between mb-6">
                                <div>
                                    <h2 className="text-xl font-bold">{viewingInstance.tasks?.title || 'Task Details'}</h2>
                                    <p className="text-muted-foreground text-sm mt-1">
                                        Assigned to {viewingInstance.employees?.display_name || viewingInstance.employees?.profiles?.full_name || 'Unknown'}
                                    </p>
                                </div>
                                <button
                                    onClick={closeDetailModal}
                                    className="p-2 hover:bg-muted rounded-full transition-colors"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>

                            {/* Status Badge */}
                            <div className="mb-6">
                                <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                                    viewingInstance.status === 'completed' ? 'bg-green-100 text-green-800' :
                                    viewingInstance.status === 'overdue' ? 'bg-red-100 text-red-800' :
                                    'bg-yellow-100 text-yellow-800'
                                }`}>
                                    {viewingInstance.status === 'completed' && '✓ '}
                                    {viewingInstance.status === 'overdue' && '⚠ '}
                                    {viewingInstance.status === 'pending' && '⏳ '}
                                    {viewingInstance.status.charAt(0).toUpperCase() + viewingInstance.status.slice(1)}
                                </span>
                            </div>

                            {/* Task Info Grid */}
                            <div className="grid grid-cols-2 gap-4 mb-6">
                                <div className="bg-muted/50 rounded-lg p-4">
                                    <p className="text-xs text-muted-foreground mb-1">Scheduled Date</p>
                                    <p className="font-medium">{formatScheduleDate(viewingInstance.scheduled_date)}</p>
                                </div>
                                <div className="bg-muted/50 rounded-lg p-4">
                                    <p className="text-xs text-muted-foreground mb-1">Completed At</p>
                                    <p className="font-medium">
                                        {viewingInstance.completed_at
                                            ? new Date(viewingInstance.completed_at).toLocaleString('en-US', {
                                                timeZone: 'America/New_York',
                                                month: 'short',
                                                day: 'numeric',
                                                year: 'numeric',
                                                hour: '2-digit',
                                                minute: '2-digit'
                                            })
                                            : 'Not completed'}
                                    </p>
                                </div>
                                {viewingInstance.tasks?.location && (
                                    <div className="bg-muted/50 rounded-lg p-4">
                                        <p className="text-xs text-muted-foreground mb-1">Location</p>
                                        <p className="font-medium">📍 {viewingInstance.tasks.location}</p>
                                    </div>
                                )}
                                {viewingInstance.tasks?.cutoff_time && (
                                    <div className="bg-muted/50 rounded-lg p-4">
                                        <p className="text-xs text-muted-foreground mb-1">Cutoff Time</p>
                                        <p className="font-medium">⏰ {formatTimeString(viewingInstance.tasks.cutoff_time)}</p>
                                    </div>
                                )}
                            </div>

                            {/* Task Description */}
                            {viewingInstance.tasks?.description && (
                                <div className="mb-6">
                                    <h3 className="text-sm font-semibold text-muted-foreground mb-2">Task Description</h3>
                                    <div className="text-sm bg-muted/30 rounded-lg p-4">
                                        <RichTextDisplay content={viewingInstance.tasks.description} />
                                    </div>
                                </div>
                            )}

                            {/* Reference Images Section - shows if signed URLs loaded */}
                            {signedRefImageUrls.length > 0 && (
                                <div className="mb-6">
                                    <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                                        🖼️ Reference Images ({signedRefImageUrls.length})
                                    </h3>
                                    <p className="text-xs text-muted-foreground mb-2">
                                        Example images showing what the completed task should look like
                                    </p>
                                    <div className={`grid gap-2 ${signedRefImageUrls.length === 1 ? '' : 'grid-cols-2 sm:grid-cols-3'}`}>
                                        {signedRefImageUrls.map((url, index) => (
                                            <img
                                                key={index}
                                                src={url}
                                                alt={`Reference ${index + 1}`}
                                                className={`w-full rounded-lg cursor-pointer hover:opacity-90 transition-opacity border ${signedRefImageUrls.length === 1 ? 'max-h-64 object-contain mx-auto' : 'h-32 object-cover'}`}
                                                onClick={() => window.open(url, '_blank')}
                                            />
                                        ))}
                                    </div>
                                    <p className="text-xs text-center text-muted-foreground mt-2">Click to view full size</p>
                                </div>
                            )}

                            {/* Reference Videos Section */}
                            {signedRefVideoUrls.length > 0 && (
                                <div className="mb-6">
                                    <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                                        🎥 Reference Videos ({signedRefVideoUrls.length})
                                    </h3>
                                    <p className="text-xs text-muted-foreground mb-2">
                                        Example videos showing how to complete the task
                                    </p>
                                    <div className="space-y-2">
                                        {signedRefVideoUrls.map((url, index) => (
                                            <video
                                                key={index}
                                                src={`${url}#t=0.1`}
                                                preload="metadata"
                                                controls
                                                className="w-full rounded-lg max-h-64"
                                            />
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Employee Submission Section */}
                            <div className="border-t pt-6">
                                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                                    <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                    </svg>
                                    Employee Submission
                                </h3>

                                {/* Notes */}
                                {viewingInstance.notes ? (
                                    <div className="mb-6">
                                        <h4 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                                            📝 Notes
                                        </h4>
                                        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                                            <p className="text-sm whitespace-pre-wrap">{viewingInstance.notes}</p>
                                        </div>
                                    </div>
                                ) : viewingInstance.tasks?.requires_notes && (
                                    <div className="mb-6">
                                        <h4 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                                            📝 Notes
                                        </h4>
                                        <p className="text-sm text-muted-foreground italic">No notes submitted yet</p>
                                    </div>
                                )}

                                {/* Photos - Multiple support */}
                                {(signedPhotoUrls.length > 0 || viewingInstance.photo_url) ? (
                                    <div className="mb-6">
                                        <h4 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                                            📷 Photos ({signedPhotoUrls.length})
                                        </h4>
                                        <div className="bg-muted/30 rounded-lg p-2">
                                            {signedPhotoUrls.length > 0 ? (
                                                <>
                                                    <div className={`grid gap-2 ${signedPhotoUrls.length === 1 ? '' : 'grid-cols-2'}`}>
                                                        {signedPhotoUrls.map((url, index) => (
                                                            <img
                                                                key={index}
                                                                src={url}
                                                                alt={`Task submission photo ${index + 1}`}
                                                                className={`w-full rounded-lg cursor-pointer hover:opacity-90 transition-opacity ${signedPhotoUrls.length === 1 ? 'max-h-96 object-contain mx-auto' : 'h-40 object-cover'}`}
                                                                onClick={() => window.open(url, '_blank')}
                                                            />
                                                        ))}
                                                    </div>
                                                    <p className="text-xs text-center text-muted-foreground mt-2">Click to view full size</p>
                                                </>
                                            ) : (
                                                <div className="flex items-center justify-center h-48 text-muted-foreground">
                                                    <div className="animate-pulse">Loading images...</div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ) : viewingInstance.tasks?.requires_photo && (
                                    <div className="mb-6">
                                        <h4 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                                            📷 Photo
                                        </h4>
                                        <p className="text-sm text-muted-foreground italic">No photo submitted yet</p>
                                    </div>
                                )}

                                {/* Video */}
                                {(viewingInstance.video_urls && viewingInstance.video_urls.length > 0) || viewingInstance.video_url ? (
                                    <div className="mb-6">
                                        <h4 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                                            🎥 Video{signedVideoUrls.length > 1 ? `s (${signedVideoUrls.length})` : ''}
                                        </h4>
                                        <div className="bg-muted/30 rounded-lg p-2">
                                            {signedVideoUrls.length > 0 ? (
                                                <>
                                                    <div className={`grid gap-2 ${signedVideoUrls.length === 1 ? '' : 'grid-cols-1'}`}>
                                                        {signedVideoUrls.map((url, index) => (
                                                            <video
                                                                key={index}
                                                                src={`${url}#t=0.1`}
                                                                preload="metadata"
                                                                controls
                                                                className={`w-full rounded-lg ${signedVideoUrls.length === 1 ? 'max-h-96' : 'max-h-64'}`}
                                                            />
                                                        ))}
                                                    </div>
                                                </>
                                            ) : (
                                                <div className="flex items-center justify-center h-48 text-muted-foreground">
                                                    <div className="animate-pulse">Loading videos...</div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ) : viewingInstance.tasks?.requires_video && (
                                    <div className="mb-6">
                                        <h4 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                                            🎥 Video
                                        </h4>
                                        <p className="text-sm text-muted-foreground italic">No video submitted yet</p>
                                    </div>
                                )}

                                {/* No submissions message */}
                                {!viewingInstance.notes && signedPhotoUrls.length === 0 && signedVideoUrls.length === 0 && (
                                    <div className="text-center py-8 text-muted-foreground">
                                        <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                        </svg>
                                        <p className="text-sm">No submission data from employee yet</p>
                                    </div>
                                )}
                            </div>

                            {/* Footer Actions */}
                            <div className="flex gap-3 pt-6 border-t mt-6">
                                <button
                                    type="button"
                                    className="btn-secondary flex-1"
                                    onClick={closeDetailModal}
                                >
                                    Close
                                </button>
                                <button
                                    type="button"
                                    className="btn-primary flex-1"
                                    onClick={() => {
                                        closeDetailModal()
                                        if (viewingInstance.status !== 'completed') {
                                            updateInstanceStatus(viewingInstance.id, 'completed')
                                        }
                                    }}
                                    disabled={viewingInstance.status === 'completed'}
                                >
                                    {viewingInstance.status === 'completed' ? 'Already Completed' : 'Mark as Completed'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Task Definition Detail Modal */}
            {showTaskDetailModal && viewingTask && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-card rounded-lg shadow-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                        <div className="p-6">
                            {/* Header */}
                            <div className="flex items-start justify-between mb-6">
                                <div>
                                    <h2 className="text-xl font-bold">{viewingTask.title}</h2>
                                    <div className="flex items-center gap-2 mt-2">
                                        {viewingTask.is_recurring && (
                                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                                                🔄 {viewingTask.frequency}
                                            </span>
                                        )}
                                        {viewingTask.role_target && (
                                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                                                {viewingTask.role_target === 'all' ? 'All Staff' : viewingTask.role_target === 'employee' ? 'Employees Only' : 'Admins Only'}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <button
                                    onClick={closeTaskDetailModal}
                                    className="p-2 hover:bg-muted rounded-full transition-colors"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>

                            {/* Task Info Grid */}
                            <div className="grid grid-cols-2 gap-4 mb-6">
                                {viewingTask.location && (
                                    <div className="bg-muted/50 rounded-lg p-4">
                                        <p className="text-xs text-muted-foreground mb-1">Location</p>
                                        <p className="font-medium">📍 {viewingTask.location}</p>
                                    </div>
                                )}
                                {viewingTask.cutoff_time && (
                                    <div className="bg-muted/50 rounded-lg p-4">
                                        <p className="text-xs text-muted-foreground mb-1">Cutoff Time</p>
                                        <p className="font-medium">⏰ {formatTimeString(viewingTask.cutoff_time)}</p>
                                    </div>
                                )}
                                <div className="bg-muted/50 rounded-lg p-4">
                                    <p className="text-xs text-muted-foreground mb-1">Created</p>
                                    <p className="font-medium">
                                        {new Date(viewingTask.created_at).toLocaleDateString('en-US', {
                                            month: 'short',
                                            day: 'numeric',
                                            year: 'numeric'
                                        })}
                                    </p>
                                </div>
                                <div className="bg-muted/50 rounded-lg p-4">
                                    <p className="text-xs text-muted-foreground mb-1">Requirements</p>
                                    <div className="flex items-center gap-2">
                                        {viewingTask.requires_photo && <span title="Photo required">📷</span>}
                                        {viewingTask.requires_video && <span title="Video required">🎥</span>}
                                        {viewingTask.requires_notes && <span title="Notes required">📝</span>}
                                        {!viewingTask.requires_photo && !viewingTask.requires_video && !viewingTask.requires_notes && (
                                            <span className="text-muted-foreground text-sm">None</span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Task Description */}
                            {viewingTask.description && (
                                <div className="mb-6">
                                    <h3 className="text-sm font-semibold text-muted-foreground mb-2">Description</h3>
                                    <div className="bg-muted/30 rounded-lg p-4 text-sm">
                                        <RichTextDisplay content={viewingTask.description} />
                                    </div>
                                </div>
                            )}

                            {/* Reference Images */}
                            {(taskDetailRefImageUrls.length > 0 || (viewingTask.reference_images && viewingTask.reference_images.length > 0)) && (
                                <div className="mb-6">
                                    <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                                        🖼️ Reference Images ({viewingTask.reference_images?.length || 0})
                                    </h3>
                                    <p className="text-xs text-muted-foreground mb-3">
                                        Example images showing what the completed task should look like
                                    </p>
                                    {taskDetailRefImageUrls.length > 0 ? (
                                        <div className={`grid gap-3 ${taskDetailRefImageUrls.length === 1 ? '' : 'grid-cols-2 sm:grid-cols-3'}`}>
                                            {taskDetailRefImageUrls.map((url, index) => (
                                                <div
                                                    key={index}
                                                    className="relative group cursor-pointer"
                                                    onClick={() => window.open(url, '_blank')}
                                                >
                                                    <img
                                                        src={url}
                                                        alt={`Reference ${index + 1}`}
                                                        className={`w-full rounded-lg hover:opacity-90 transition-opacity border shadow-sm ${taskDetailRefImageUrls.length === 1 ? 'max-h-80 object-contain mx-auto' : 'h-40 object-cover'}`}
                                                    />
                                                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 rounded-lg transition-colors flex items-center justify-center pointer-events-none">
                                                        <span className="opacity-0 group-hover:opacity-100 text-white bg-black/50 px-2 py-1 rounded text-xs">
                                                            Click to view full size
                                                        </span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="flex items-center justify-center h-32 bg-muted/30 rounded-lg">
                                            <div className="animate-pulse text-muted-foreground">Loading images...</div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Reference Videos */}
                            {(taskDetailRefVideoUrls.length > 0 || (viewingTask.reference_videos && viewingTask.reference_videos.length > 0)) && (
                                <div className="mb-6">
                                    <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                                        🎬 Reference Videos ({viewingTask.reference_videos?.length || 0})
                                    </h3>
                                    <p className="text-xs text-muted-foreground mb-3">
                                        Example videos showing how to complete the task
                                    </p>
                                    {taskDetailRefVideoUrls.length > 0 ? (
                                        <div className="space-y-3">
                                            {taskDetailRefVideoUrls.map((url, index) => (
                                                <video
                                                    key={index}
                                                    src={`${url}#t=0.1`}
                                                    preload="metadata"
                                                    controls
                                                    className="w-full rounded-lg max-h-80 border shadow-sm"
                                                />
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="flex items-center justify-center h-32 bg-muted/30 rounded-lg">
                                            <div className="animate-pulse text-muted-foreground">Loading videos...</div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* No media message */}
                            {!viewingTask.description && !viewingTask.reference_images?.length && !viewingTask.reference_videos?.length && (
                                <div className="text-center py-8 text-muted-foreground bg-muted/30 rounded-lg mb-6">
                                    <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                    </svg>
                                    <p className="text-sm">No description or reference media added to this task</p>
                                </div>
                            )}

                            {/* Footer Actions */}
                            <div className="flex gap-3 pt-6 border-t mt-6">
                                <button
                                    type="button"
                                    className="btn-secondary flex-1"
                                    onClick={closeTaskDetailModal}
                                >
                                    Close
                                </button>
                                <button
                                    type="button"
                                    className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-50 border border-gray-200 rounded-md hover:bg-gray-100 transition-colors flex-1"
                                    onClick={() => {
                                        closeTaskDetailModal()
                                        openModal(viewingTask)
                                    }}
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                    </svg>
                                    Edit Task
                                </button>
                                <button
                                    type="button"
                                    className="btn-primary flex-1"
                                    onClick={() => {
                                        closeTaskDetailModal()
                                        openAssignModal(viewingTask)
                                    }}
                                >
                                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                                    </svg>
                                    Assign to Employee
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
