'use client'

import { useState, useRef } from 'react'
import { createUntypedClient, createClient } from '@/lib/supabase/client'
import { formatDateTime } from '@/lib/utils'
import { usePolicies, invalidateQueries } from '@/lib/hooks/useData'
import { MediaType } from '@/types/supabase'

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

export default function PoliciesPage() {
    const { data: policies = [], isLoading: loading, mutate } = usePolicies()
    const [showModal, setShowModal] = useState(false)
    const [editingPolicy, setEditingPolicy] = useState<PolicyStrip | null>(null)

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
                                        <p className="text-sm text-muted-foreground">{policy.content}</p>

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
                                    <div className="flex gap-2">
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

            {/* Modal */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/50" onClick={closeModal}></div>
                    <div className="relative card w-full max-w-lg max-h-[90vh] overflow-y-auto">
                        <div className="card-header">
                            <h2 className="card-title">
                                {editingPolicy ? 'Edit Policy' : 'Add Policy'}
                            </h2>
                        </div>
                        <form onSubmit={handleSubmit}>
                            <div className="card-content space-y-4">
                                <div>
                                    <label className="label mb-2 block">Title</label>
                                    <input
                                        type="text"
                                        className="input"
                                        value={title}
                                        onChange={(e) => setTitle(e.target.value)}
                                        required
                                        placeholder="Policy title"
                                    />
                                </div>
                                <div>
                                    <label className="label mb-2 block">Content</label>
                                    <textarea
                                        className="input min-h-[100px]"
                                        value={content}
                                        onChange={(e) => setContent(e.target.value)}
                                        required
                                        placeholder="Policy message shown to employees"
                                    />
                                </div>
                                <div>
                                    <label className="label mb-2 block">Category (optional)</label>
                                    <input
                                        type="text"
                                        className="input"
                                        value={category}
                                        onChange={(e) => setCategory(e.target.value)}
                                        placeholder="e.g., marketing, liability, script"
                                    />
                                </div>

                                {/* Media Upload */}
                                <div>
                                    <label className="label mb-2 block">Media (Image or Video)</label>

                                    {/* Existing Media Preview */}
                                    {existingMediaUrl && !removeMedia && !mediaPreview && (
                                        <div className="mb-2">
                                            <p className="text-xs text-muted-foreground mb-1">Current media:</p>
                                            {editingPolicy?.media_type === 'image' ? (
                                                <img
                                                    src={existingMediaUrl}
                                                    alt="Current media"
                                                    className="max-w-full max-h-40 rounded-lg object-cover"
                                                />
                                            ) : (
                                                <video
                                                    src={existingMediaUrl}
                                                    className="max-w-full max-h-40 rounded-lg"
                                                    controls
                                                />
                                            )}
                                            <button
                                                type="button"
                                                onClick={clearMedia}
                                                className="btn-ghost btn-sm text-destructive mt-1"
                                            >
                                                Remove media
                                            </button>
                                        </div>
                                    )}

                                    {/* New Media Preview */}
                                    {mediaPreview && (
                                        <div className="mb-2">
                                            <p className="text-xs text-muted-foreground mb-1">New media preview:</p>
                                            {mediaType === 'image' ? (
                                                <img
                                                    src={mediaPreview}
                                                    alt="Preview"
                                                    className="max-w-full max-h-40 rounded-lg object-cover"
                                                />
                                            ) : (
                                                <video
                                                    src={mediaPreview}
                                                    className="max-w-full max-h-40 rounded-lg"
                                                    controls
                                                />
                                            )}
                                            <button
                                                type="button"
                                                onClick={clearMedia}
                                                className="btn-ghost btn-sm text-destructive mt-1"
                                            >
                                                Remove
                                            </button>
                                        </div>
                                    )}

                                    {/* File Input */}
                                    {(!existingMediaUrl || removeMedia) && !mediaPreview && (
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            accept="image/*,video/*"
                                            onChange={handleFileChange}
                                            className="input file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-primary file:text-primary-foreground file:cursor-pointer"
                                        />
                                    )}
                                    <p className="text-xs text-muted-foreground mt-1">
                                        Max size: 100MB for videos, 50MB for images
                                    </p>
                                </div>

                                <div className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        id="isActive"
                                        checked={isActive}
                                        onChange={(e) => setIsActive(e.target.checked)}
                                        className="rounded border-gray-300"
                                    />
                                    <label htmlFor="isActive" className="text-sm">
                                        Active (visible to employees)
                                    </label>
                                </div>
                            </div>
                            <div className="card-footer gap-3 justify-end">
                                <button type="button" onClick={closeModal} className="btn-outline">
                                    Cancel
                                </button>
                                <button type="submit" className="btn-primary" disabled={saving || uploading}>
                                    {uploading ? 'Uploading...' : saving ? 'Saving...' : editingPolicy ? 'Update' : 'Create'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}
