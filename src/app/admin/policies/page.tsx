'use client'

import { useEffect, useState } from 'react'
import { createClient, createUntypedClient } from '@/lib/supabase/client'
import { formatDateTime } from '@/lib/utils'

interface PolicyStrip {
    id: string
    title: string
    content: string
    category: string | null
    is_active: boolean
    created_at: string
    updated_at: string
}

export default function PoliciesPage() {
    const [policies, setPolicies] = useState<PolicyStrip[]>([])
    const [loading, setLoading] = useState(true)
    const [showModal, setShowModal] = useState(false)
    const [editingPolicy, setEditingPolicy] = useState<PolicyStrip | null>(null)

    // Form state
    const [title, setTitle] = useState('')
    const [content, setContent] = useState('')
    const [category, setCategory] = useState('')
    const [isActive, setIsActive] = useState(true)
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        loadPolicies()
    }, [])

    async function loadPolicies() {
        setLoading(true)
        try {
            const supabase = createClient()
            const { data, error } = await supabase
                .from('policy_strips')
                .select('*')
                .order('created_at', { ascending: false })

            if (error) throw error
            setPolicies(data || [])
        } catch (err) {
            console.error('Error loading policies:', err)
        } finally {
            setLoading(false)
        }
    }

    async function togglePolicyStatus(id: string, currentStatus: boolean) {
        try {
            const supabase = createUntypedClient()
            const { error } = await supabase
                .from('policy_strips')
                .update({ is_active: !currentStatus })
                .eq('id', id)

            if (error) throw error
            await loadPolicies()
        } catch (err) {
            console.error('Error toggling policy:', err)
        }
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setSaving(true)

        try {
            const supabase = createUntypedClient()

            if (editingPolicy) {
                const { error } = await supabase
                    .from('policy_strips')
                    .update({
                        title,
                        content,
                        category: category || null,
                        is_active: isActive,
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
                    })

                if (error) throw error
            }

            await loadPolicies()
            closeModal()
        } catch (err) {
            console.error('Error saving policy:', err)
            alert('Failed to save policy')
        } finally {
            setSaving(false)
        }
    }

    function openModal(policy?: PolicyStrip) {
        if (policy) {
            setEditingPolicy(policy)
            setTitle(policy.title)
            setContent(policy.content)
            setCategory(policy.category || '')
            setIsActive(policy.is_active)
        } else {
            setEditingPolicy(null)
            setTitle('')
            setContent('')
            setCategory('')
            setIsActive(true)
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
    }

    async function deletePolicy(id: string) {
        if (!confirm('Are you sure you want to delete this policy?')) return

        try {
            const supabase = createClient()
            const { error } = await supabase
                .from('policy_strips')
                .delete()
                .eq('id', id)

            if (error) throw error
            await loadPolicies()
        } catch (err) {
            console.error('Error deleting policy:', err)
        }
    }

    const activePolicies = policies.filter((p) => p.is_active)
    const inactivePolicies = policies.filter((p) => !p.is_active)

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold">Policies</h1>
                    <p className="text-muted-foreground mt-1">
                        Manage policy messages shown to employees
                    </p>
                </div>
                <button className="btn-primary" onClick={() => openModal()}>
                    + Add Policy
                </button>
            </div>

            {/* Summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="card p-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Total Policies</p>
                            <p className="text-2xl font-bold">{policies.length}</p>
                        </div>
                        <span className="text-2xl">📋</span>
                    </div>
                </div>
                <div className="card p-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Active</p>
                            <p className="text-2xl font-bold text-green-600">{activePolicies.length}</p>
                        </div>
                        <span className="text-2xl">✅</span>
                    </div>
                </div>
                <div className="card p-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Inactive</p>
                            <p className="text-2xl font-bold text-gray-400">{inactivePolicies.length}</p>
                        </div>
                        <span className="text-2xl">⏸️</span>
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
                    {policies.map((policy) => (
                        <div
                            key={policy.id}
                            className={`card ${!policy.is_active ? 'opacity-60' : ''}`}
                        >
                            <div className="p-4">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-1">
                                            <h3 className="font-semibold">{policy.title}</h3>
                                            {policy.is_active ? (
                                                <span className="badge-success text-xs">Active</span>
                                            ) : (
                                                <span className="badge-secondary text-xs">Inactive</span>
                                            )}
                                            {policy.category && (
                                                <span className="badge-outline text-xs">{policy.category}</span>
                                            )}
                                        </div>
                                        <p className="text-sm text-muted-foreground">{policy.content}</p>
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
                    <div className="relative card w-full max-w-lg">
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
                                <button type="submit" className="btn-primary" disabled={saving}>
                                    {saving ? 'Saving...' : editingPolicy ? 'Update' : 'Create'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}
