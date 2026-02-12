'use client'

import { useState, useRef } from 'react'
import { createUntypedClient, createClient } from '@/lib/supabase/client'
import { formatDateTime } from '@/lib/utils'
import { usePolicies, useEmployees, invalidateQueries } from '@/lib/hooks/useData'
import { MediaType } from '@/types/supabase'
import { RichTextEditor, RichTextDisplay } from '@/components/RichTextEditor'

interface PolicyStrip {
    id: string
    title: string
    content: string
    category: string | null
    is_active: boolean
    image_url: string | null
    video_url: string | null
    media_type: MediaType | null
    created_at: string
    updated_at: string
}

interface Employee {
    id: string
    display_name: string | null
    is_active: boolean
    profiles: {
        full_name: string
        email: string
        status: string
    } | null
}

export default function PoliciesPage() {
    const { data: policies = [], isLoading: loading, mutate } = usePolicies()
    const { data: allEmployees = [] } = useEmployees()

    // Filter to only active employees with valid profiles
    const employees = allEmployees.filter((emp: Employee) =>
        emp.is_active && emp.profiles?.status === 'active' && emp.profiles?.email
    )
    const [showModal, setShowModal] = useState(false)
    const [editingPolicy, setEditingPolicy] = useState<PolicyStrip | null>(null)

    // Send to employee modal state
    const [showSendModal, setShowSendModal] = useState(false)
    const [sendingPolicy, setSendingPolicy] = useState<PolicyStrip | null>(null)
    const [selectedEmployeeId, setSelectedEmployeeId] = useState('')
    const [sending, setSending] = useState(false)
    const [sendSuccess, setSendSuccess] = useState<string | null>(null)

    // Form state
    const [title, setTitle] = useState('')
    const [content, setContent] = useState('')
    const [category, setCategory] = useState('')
    const [isActive, setIsActive] = useState(true)
    const [mediaType, setMediaType] = useState<MediaType>('none')
    const [mediaFile, setMediaFile] = useState<File | null>(null)
    const [mediaPreview, setMediaPreview] = useState<string | null>(null)
    const [existingMediaUrl, setExistingMediaUrl] = useState<string | null>(null)
    const [removeMedia, setRemoveMedia] = useState(false)
    const [saving, setSaving] = useState(false)
    const [uploading, setUploading] = useState(false)

    const fileInputRef = useRef<HTMLInputElement>(null)

    async function togglePolicyStatus(id: string, currentStatus: boolean) {
        try {
            const supabase = createUntypedClient()
            const { error } = await supabase
                .from('policy_strips')
                .update({ is_active: !currentStatus })
                .eq('id', id)

            if (error) throw error
            invalidateQueries.policies()
            mutate()
        } catch (err) {
            console.error('Error toggling policy:', err)
        }
    }

    async function uploadMedia(file: File, type: 'image' | 'video'): Promise<string> {
        const supabase = createClient()
        const fileExt = file.name.split('.').pop()
        const fileName = `${type}-${Date.now()}.${fileExt}`

        const { error: uploadError } = await supabase.storage
            .from('policy-media')
            .upload(fileName, file)

        if (uploadError) throw uploadError

        const { data } = supabase.storage
            .from('policy-media')
            .getPublicUrl(fileName)

        return data.publicUrl
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setSaving(true)

        try {
            const supabase = createUntypedClient()

            let imageUrl: string | null = null
            let videoUrl: string | null = null
            let finalMediaType: MediaType = 'none'

            // Handle media upload
            if (mediaFile && mediaType !== 'none') {
                setUploading(true)
                const url = await uploadMedia(mediaFile, mediaType as 'image' | 'video')
                if (mediaType === 'image') {
                    imageUrl = url
                } else {
                    videoUrl = url
                }
                finalMediaType = mediaType
                setUploading(false)
            } else if (!removeMedia && existingMediaUrl) {
                // Keep existing media
                if (editingPolicy?.media_type === 'image') {
                    imageUrl = existingMediaUrl
                    finalMediaType = 'image'
                } else if (editingPolicy?.media_type === 'video') {
                    videoUrl = existingMediaUrl
                    finalMediaType = 'video'
                }
            }

            if (editingPolicy) {
                const { error } = await supabase
                    .from('policy_strips')
                    .update({
                        title,
                        content,
                        category: category || null,
                        is_active: isActive,
                        image_url: imageUrl,
                        video_url: videoUrl,
                        media_type: finalMediaType,
                    })
                    .eq('id', editingPolicy.id)

                if (error) throw error
            } else {
                const { error } = await supabase
                    .from('policy_strips')
                    .insert({
                        title,
                        content,
                        category: category || null,
                        is_active: isActive,
                        image_url: imageUrl,
                        video_url: videoUrl,
                        media_type: finalMediaType,
                    })

                if (error) throw error
            }

            invalidateQueries.policies()
            mutate()
            closeModal()
        } catch (err) {
            console.error('Error saving policy:', err)
            alert('Failed to save policy')
        } finally {
            setSaving(false)
            setUploading(false)
        }
    }

    function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        if (!file) return

        // Determine media type from file
        if (file.type.startsWith('image/')) {
            setMediaType('image')
        } else if (file.type.startsWith('video/')) {
            setMediaType('video')
        } else {
            alert('Please select an image or video file')
            return
        }

        setMediaFile(file)
        setRemoveMedia(false)

        // Create preview
        const reader = new FileReader()
        reader.onloadend = () => {
            setMediaPreview(reader.result as string)
        }
        reader.readAsDataURL(file)
    }

    function clearMedia() {
        setMediaFile(null)
        setMediaPreview(null)
        setMediaType('none')
        setRemoveMedia(true)
        if (fileInputRef.current) {
            fileInputRef.current.value = ''
        }
    }

    function openModal(policy?: PolicyStrip) {
        if (policy) {
            setEditingPolicy(policy)
            setTitle(policy.title)
            setContent(policy.content)
            setCategory(policy.category || '')
            setIsActive(policy.is_active)
            setMediaType(policy.media_type || 'none')
            setExistingMediaUrl(policy.image_url || policy.video_url || null)
            setMediaFile(null)
            setMediaPreview(null)
            setRemoveMedia(false)
        } else {
            setEditingPolicy(null)
            setTitle('')
            setContent('')
            setCategory('')
            setIsActive(true)
            setMediaType('none')
            setExistingMediaUrl(null)
            setMediaFile(null)
            setMediaPreview(null)
            setRemoveMedia(false)
        }
        setShowModal(true)
    }

    function closeModal() {
        setShowModal(false)
        setEditingPolicy(null)
        setTitle('')
        setContent('')
        setCategory('')
        setIsActive(true)
        setMediaType('none')
        setExistingMediaUrl(null)
        setMediaFile(null)
        setMediaPreview(null)
        setRemoveMedia(false)
    }

    async function deletePolicy(id: string) {
        if (!confirm('Are you sure you want to delete this policy?')) return

        try {
            const supabase = createUntypedClient()
            const { error } = await supabase
                .from('policy_strips')
                .delete()
                .eq('id', id)

            if (error) throw error
            invalidateQueries.policies()
            mutate()
        } catch (err) {
            console.error('Error deleting policy:', err)
        }
    }

    function openSendModal(policy: PolicyStrip) {
        setSendingPolicy(policy)
        setSelectedEmployeeId('')
        setSendSuccess(null)
        setShowSendModal(true)
    }

    function closeSendModal() {
        setShowSendModal(false)
        setSendingPolicy(null)
        setSelectedEmployeeId('')
        setSendSuccess(null)
    }

    async function sendPolicyToEmployee() {
        if (!sendingPolicy || !selectedEmployeeId) return

        setSending(true)
        setSendSuccess(null)

        try {
            const response = await fetch('/api/policies/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    policyId: sendingPolicy.id,
                    employeeId: selectedEmployeeId,
                }),
            })

            const data = await response.json()

            if (!response.ok) {
                throw new Error(data.error || 'Failed to send policy')
            }

            setSendSuccess(data.message)
            setSelectedEmployeeId('')
        } catch (err) {
            console.error('Error sending policy:', err)
            alert(err instanceof Error ? err.message : 'Failed to send policy')
        } finally {
            setSending(false)
        }
    }

    const activePolicies = policies.filter((p: PolicyStrip) => p.is_active)
    const inactivePolicies = policies.filter((p: PolicyStrip) => !p.is_active)

    return (
        <div className="space-y-4 sm:space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold">Policies</h1>
                    <p className="text-muted-foreground mt-1 text-sm sm:text-base">
                        Manage policy messages shown to employees
                    </p>
                </div>
                <button className="btn-primary w-full sm:w-auto" onClick={() => openModal()}>
                    + Add Policy
                </button>
            </div>

            {/* Summary */}
            <div className="grid grid-cols-3 gap-2 sm:gap-4">
                <div className="card p-3 sm:p-4">
                    <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                            <p className="text-xs sm:text-sm text-muted-foreground truncate">Total</p>
                            <p className="text-lg sm:text-2xl font-bold">{policies.length}</p>
                        </div>
                        <span className="text-lg sm:text-2xl flex-shrink-0">📋</span>
                    </div>
                </div>
                <div className="card p-3 sm:p-4">
                    <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                            <p className="text-xs sm:text-sm text-muted-foreground truncate">Active</p>
                            <p className="text-lg sm:text-2xl font-bold text-green-600">{activePolicies.length}</p>
                        </div>
                        <span className="text-lg sm:text-2xl flex-shrink-0">✅</span>
                    </div>
                </div>
                <div className="card p-3 sm:p-4">
                    <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                            <p className="text-xs sm:text-sm text-muted-foreground truncate">Inactive</p>
                            <p className="text-lg sm:text-2xl font-bold text-gray-400">{inactivePolicies.length}</p>
                        </div>
                        <span className="text-lg sm:text-2xl flex-shrink-0">⏸️</span>
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="space-y-4">
                    {[...Array(5)].map((_, i) => (
                        <div key={i} className="h-24 bg-muted rounded-lg animate-pulse"></div>
                    ))}
                </div>
            ) : policies.length === 0 ? (
                <div className="card p-8 text-center">
                    <p className="text-muted-foreground mb-4">No policies created yet</p>
                    <button className="btn-primary" onClick={() => openModal()}>
                        Create Your First Policy
                    </button>
                </div>
            ) : (
                <div className="space-y-4">
                    {policies.map((policy: PolicyStrip) => (
                        <div
                            key={policy.id}
                            className={`card ${!policy.is_active ? 'opacity-60' : ''}`}
                        >
                            <div className="p-4">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                                            <h3 className="font-semibold">{policy.title}</h3>
                                            {policy.is_active ? (
                                                <span className="badge-success text-xs">Active</span>
                                            ) : (
                                                <span className="badge-secondary text-xs">Inactive</span>
                                            )}
                                            {policy.category && (
                                                <span className="badge-outline text-xs">{policy.category}</span>
                                            )}
                                            {policy.media_type && policy.media_type !== 'none' && (
                                                <span className="badge-default text-xs">
                                                    {policy.media_type === 'image' ? '🖼️ Image' : '🎬 Video'}
                                                </span>
                                            )}
                                        </div>
                                        <RichTextDisplay content={policy.content} className="text-sm text-muted-foreground" />

                                        {/* Media Preview */}
                                        {policy.media_type === 'image' && policy.image_url && (
                                            <div className="mt-2">
                                                <img
                                                    src={policy.image_url}
                                                    alt="Policy media"
                                                    className="max-w-xs max-h-32 rounded-lg object-cover"
                                                />
                                            </div>
                                        )}
                                        {policy.media_type === 'video' && policy.video_url && (
                                            <div className="mt-2">
                                                <video
                                                    src={policy.video_url}
                                                    className="max-w-xs max-h-32 rounded-lg"
                                                    controls
                                                />
                                            </div>
                                        )}

                                        <p className="text-xs text-muted-foreground mt-2">
                                            Last updated: {formatDateTime(policy.updated_at)}
                                        </p>
                                    </div>
                                    <div className="flex gap-2 flex-wrap">
                                        <button
                                            onClick={() => openSendModal(policy)}
                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-lg transition-colors"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                            </svg>
                                            Email Policy to Employee
                                        </button>
                                        <button
                                            onClick={() => togglePolicyStatus(policy.id, policy.is_active)}
                                            className="btn-ghost btn-sm"
                                        >
                                            {policy.is_active ? '⏸️' : '▶️'}
                                        </button>
                                        <button
                                            onClick={() => openModal(policy)}
                                            className="btn-ghost btn-sm"
                                        >
                                            ✏️
                                        </button>
                                        <button
                                            onClick={() => deletePolicy(policy.id)}
                                            className="btn-ghost btn-sm text-destructive"
                                        >
                                            🗑️
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Modal - Google Style */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={closeModal}></div>
                    <div className="relative bg-white dark:bg-gray-900 w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl">
                        {/* Header */}
                        <div className="sticky top-0 bg-white dark:bg-gray-900 px-6 py-5 border-b border-gray-100 dark:border-gray-800 z-10">
                            <div className="flex items-center justify-between">
                                <h2 className="text-xl font-medium text-gray-900 dark:text-white">
                                    {editingPolicy ? 'Edit Policy' : 'Create New Policy'}
                                </h2>
                                <button
                                    type="button"
                                    onClick={closeModal}
                                    className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
                                >
                                    <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                        </div>

                        <form onSubmit={handleSubmit}>
                            <div className="px-6 py-6 space-y-6">
                                {/* Title Field */}
                                <div className="relative">
                                    <input
                                        type="text"
                                        id="policy-title"
                                        className="peer w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-700 rounded-xl bg-transparent text-gray-900 dark:text-white placeholder-transparent focus:border-blue-500 focus:outline-none transition-colors"
                                        value={title}
                                        onChange={(e) => setTitle(e.target.value)}
                                        required
                                        placeholder="Policy title"
                                    />
                                    <label
                                        htmlFor="policy-title"
                                        className="absolute left-3 -top-2.5 bg-white dark:bg-gray-900 px-2 text-sm text-gray-500 dark:text-gray-400 transition-all peer-placeholder-shown:top-3.5 peer-placeholder-shown:text-base peer-placeholder-shown:text-gray-400 peer-focus:-top-2.5 peer-focus:text-sm peer-focus:text-blue-500"
                                    >
                                        Policy Title *
                                    </label>
                                </div>

                                {/* Content Field */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                        Policy Content *
                                    </label>
                                    <RichTextEditor
                                        value={content}
                                        onChange={setContent}
                                        placeholder="Enter policy content..."
                                        minHeight="140px"
                                        required
                                    />
                                    <p className="mt-1.5 text-xs text-gray-400">
                                        This message will be displayed to employees
                                    </p>
                                </div>

                                {/* Category Field */}
                                <div className="relative">
                                    <input
                                        type="text"
                                        id="policy-category"
                                        className="peer w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-700 rounded-xl bg-transparent text-gray-900 dark:text-white placeholder-transparent focus:border-blue-500 focus:outline-none transition-colors"
                                        value={category}
                                        onChange={(e) => setCategory(e.target.value)}
                                        placeholder="Category"
                                    />
                                    <label
                                        htmlFor="policy-category"
                                        className="absolute left-3 -top-2.5 bg-white dark:bg-gray-900 px-2 text-sm text-gray-500 dark:text-gray-400 transition-all peer-placeholder-shown:top-3.5 peer-placeholder-shown:text-base peer-placeholder-shown:text-gray-400 peer-focus:-top-2.5 peer-focus:text-sm peer-focus:text-blue-500"
                                    >
                                        Category (optional)
                                    </label>
                                    <p className="mt-1.5 text-xs text-gray-400">
                                        e.g., Marketing, Liability, Script, Safety
                                    </p>
                                </div>

                                {/* Media Upload Section */}
                                <div className="space-y-3">
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                        Media Attachment
                                    </label>

                                    {/* Existing Media Preview */}
                                    {existingMediaUrl && !removeMedia && !mediaPreview && (
                                        <div className="relative rounded-xl overflow-hidden bg-gray-50 dark:bg-gray-800 p-4">
                                            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Current media</p>
                                            <div className="flex items-center gap-4">
                                                {editingPolicy?.media_type === 'image' ? (
                                                    <img
                                                        src={existingMediaUrl}
                                                        alt="Current media"
                                                        className="w-24 h-24 rounded-lg object-cover"
                                                    />
                                                ) : (
                                                    <video
                                                        src={existingMediaUrl}
                                                        className="w-32 h-24 rounded-lg object-cover"
                                                        controls
                                                    />
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={clearMedia}
                                                    className="flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                                >
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                    </svg>
                                                    Remove
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {/* New Media Preview */}
                                    {mediaPreview && (
                                        <div className="relative rounded-xl overflow-hidden bg-gray-50 dark:bg-gray-800 p-4">
                                            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">New media preview</p>
                                            <div className="flex items-center gap-4">
                                                {mediaType === 'image' ? (
                                                    <img
                                                        src={mediaPreview}
                                                        alt="Preview"
                                                        className="w-24 h-24 rounded-lg object-cover"
                                                    />
                                                ) : (
                                                    <video
                                                        src={mediaPreview}
                                                        className="w-32 h-24 rounded-lg object-cover"
                                                        controls
                                                    />
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={clearMedia}
                                                    className="flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                                >
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                    </svg>
                                                    Remove
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {/* File Input - Drag & Drop Style */}
                                    {(!existingMediaUrl || removeMedia) && !mediaPreview && (
                                        <div
                                            className="relative border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-8 text-center hover:border-blue-400 dark:hover:border-blue-500 transition-colors cursor-pointer"
                                            onClick={() => fileInputRef.current?.click()}
                                        >
                                            <input
                                                ref={fileInputRef}
                                                type="file"
                                                accept="image/*,video/*"
                                                onChange={handleFileChange}
                                                className="hidden"
                                            />
                                            <div className="flex flex-col items-center gap-3">
                                                <div className="w-12 h-12 rounded-full bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center">
                                                    <svg className="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                                    </svg>
                                                </div>
                                                <div>
                                                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                                        Click to upload image or video
                                                    </p>
                                                    <p className="text-xs text-gray-400 mt-1">
                                                        PNG, JPG, GIF, MP4 up to 100MB
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Active Toggle - Switch Style */}
                                <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-xl">
                                    <div>
                                        <p className="text-sm font-medium text-gray-900 dark:text-white">Policy Status</p>
                                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                            {isActive ? 'Visible to employees' : 'Hidden from employees'}
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setIsActive(!isActive)}
                                        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                            isActive ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
                                        }`}
                                    >
                                        <span
                                            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                                isActive ? 'translate-x-5' : 'translate-x-0'
                                            }`}
                                        />
                                    </button>
                                </div>
                            </div>

                            {/* Footer */}
                            <div className="sticky bottom-0 bg-gray-50 dark:bg-gray-800/50 px-6 py-4 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={closeModal}
                                    className="px-5 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={saving || uploading}
                                    className="px-5 py-2.5 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center gap-2"
                                >
                                    {(saving || uploading) && (
                                        <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                    )}
                                    {uploading ? 'Uploading...' : saving ? 'Saving...' : editingPolicy ? 'Save Changes' : 'Create Policy'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Send to Employee Modal - Google Style */}
            {showSendModal && sendingPolicy && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={closeSendModal}></div>
                    <div className="relative bg-white dark:bg-gray-900 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden">
                        {/* Header */}
                        <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-800">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                                        <svg className="w-5 h-5 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                        </svg>
                                    </div>
                                    <h2 className="text-lg font-medium text-gray-900 dark:text-white">
                                        Send Policy
                                    </h2>
                                </div>
                                <button
                                    type="button"
                                    onClick={closeSendModal}
                                    className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
                                >
                                    <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                        </div>

                        <div className="px-6 py-5 space-y-5">
                            {/* Policy Card */}
                            <div className="p-4 bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 rounded-xl border border-purple-100 dark:border-purple-800/30">
                                <div className="flex items-start gap-3">
                                    <div className="w-8 h-8 rounded-lg bg-white dark:bg-gray-800 shadow-sm flex items-center justify-center flex-shrink-0">
                                        <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                        </svg>
                                    </div>
                                    <div>
                                        <p className="font-medium text-gray-900 dark:text-white">{sendingPolicy.title}</p>
                                        {sendingPolicy.category && (
                                            <span className="inline-block mt-1.5 px-2 py-0.5 text-xs font-medium text-purple-700 dark:text-purple-300 bg-purple-100 dark:bg-purple-900/40 rounded-full">
                                                {sendingPolicy.category}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Success Message */}
                            {sendSuccess && (
                                <div className="flex items-center gap-3 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/30 rounded-xl">
                                    <div className="w-8 h-8 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center flex-shrink-0">
                                        <svg className="w-4 h-4 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                        </svg>
                                    </div>
                                    <p className="text-sm font-medium text-green-700 dark:text-green-300">{sendSuccess}</p>
                                </div>
                            )}

                            {/* Employee Select */}
                            <div className="relative">
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    Select Employee
                                </label>
                                <div className="relative">
                                    <select
                                        className="w-full px-4 py-3 pr-10 border-2 border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:border-blue-500 focus:outline-none transition-colors appearance-none cursor-pointer"
                                        value={selectedEmployeeId}
                                        onChange={(e) => setSelectedEmployeeId(e.target.value)}
                                    >
                                        <option value="">Choose an employee...</option>
                                        {employees.map((emp: Employee) => (
                                            <option key={emp.id} value={emp.id}>
                                                {emp.display_name || emp.profiles?.full_name || 'Unknown'} ({emp.profiles?.email || 'No email'})
                                            </option>
                                        ))}
                                    </select>
                                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                                        <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                        </svg>
                                    </div>
                                </div>
                                <p className="mt-2 text-xs text-gray-400">
                                    The policy will be sent to the employee&apos;s email address
                                </p>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="bg-gray-50 dark:bg-gray-800/50 px-6 py-4 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-3">
                            <button
                                type="button"
                                onClick={closeSendModal}
                                className="px-5 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                            >
                                Close
                            </button>
                            <button
                                type="button"
                                onClick={sendPolicyToEmployee}
                                disabled={sending || !selectedEmployeeId}
                                className="px-5 py-2.5 text-sm font-medium text-white bg-purple-500 hover:bg-purple-600 disabled:bg-purple-300 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center gap-2"
                            >
                                {sending && (
                                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                )}
                                {sending ? 'Sending...' : 'Send Policy'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
