'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { createUntypedClient } from '@/lib/supabase/client'
import { RichTextEditor } from '@/components/RichTextEditor'
import { resumableUpload, shouldUseTus } from '@/lib/resumable-upload'

interface Business {
  id: number
  name: string
  location: string | null
}

interface ContentRow {
  id: string
  business_id: number
  type: 'video' | 'document' | 'article'
  subtype: string | null
  title: string
  description: string | null
  content_url: string | null
  content_text: string | null
  duration_seconds: number | null
  file_size: number | null
  is_required: boolean
  sort_order: number
  created_at: string
  businesses: Business | null
}

const fetcher = async (url: string) => {
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

const supabase = createUntypedClient()

/**
 * Direct upload with XHR-driven progress for files that don't qualify for TUS
 * (i.e. non-video, or small videos under the TUS threshold).
 * Falls through to a plain POST against the Supabase Storage REST endpoint.
 */
async function uploadWithProgress(
  file: File,
  path: string,
  bucketName: string,
  onProgress: (pct: number) => void
): Promise<void> {
  const { data: { session } } = await supabase.auth.refreshSession()
  if (!session?.access_token) throw new Error('Not authenticated')

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  // Each path segment must be URL-encoded individually
  const encodedPath = path.split('/').map(encodeURIComponent).join('/')
  const url = `${supabaseUrl}/storage/v1/object/${bucketName}/${encodedPath}`

  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.setRequestHeader('Authorization', `Bearer ${session.access_token}`)
    // 1-year cache: paths are timestamp-namespaced, so files are effectively immutable.
    xhr.setRequestHeader('Cache-Control', 'max-age=31536000')
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    xhr.setRequestHeader('x-upsert', 'false')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.min(99, Math.round((e.loaded / e.total) * 100))
        onProgress(pct)
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100)
        resolve()
      } else {
        let msg = `Upload failed (${xhr.status})`
        try {
          const json = JSON.parse(xhr.responseText)
          msg = json.message || json.error || msg
        } catch { /* ignore parse error */ }
        reject(new Error(msg))
      }
    }
    xhr.onerror = () => reject(new Error('Network error during upload'))
    xhr.onabort = () => reject(new Error('Upload cancelled'))
    xhr.send(file)
  })
}

const SUBTYPE_FOR_MIME: Record<string, { type: 'document' | 'video'; subtype: string }> = {
  'application/pdf': { type: 'document', subtype: 'pdf' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { type: 'document', subtype: 'docx' },
  'application/msword': { type: 'document', subtype: 'docx' },
  'image/jpeg': { type: 'document', subtype: 'image' },
  'image/png': { type: 'document', subtype: 'image' },
  'image/gif': { type: 'document', subtype: 'image' },
  'image/webp': { type: 'document', subtype: 'image' },
  'audio/mpeg': { type: 'document', subtype: 'audio' },
  'audio/wav': { type: 'document', subtype: 'audio' },
  'audio/ogg': { type: 'document', subtype: 'audio' },
  'audio/mp4': { type: 'document', subtype: 'audio' },
  'video/mp4': { type: 'video', subtype: 'video' },
  'video/quicktime': { type: 'video', subtype: 'video' },
  'video/webm': { type: 'video', subtype: 'video' },
}

export default function AdminOnboardingPage() {
  const { data: contentData, isLoading, mutate } = useSWR<{ content: ContentRow[] }>(
    '/api/admin/onboarding/content',
    fetcher
  )
  const { data: bizData } = useSWR<{ businesses: Business[] }>(
    'admin:businesses',
    async () => {
      const { data, error } = await supabase
        .from('businesses')
        .select('id, name, location')
        .order('name')
        .order('location')
      if (error) throw error
      return { businesses: data || [] }
    }
  )

  // Admins are employees too — surface their own outstanding training so it
  // isn't buried behind the management view.
  const { data: myTraining } = useSWR<{ total_pending: number }>(
    '/api/onboarding/pending',
    fetcher
  )
  const myPending = myTraining?.total_pending || 0

  const businesses = bizData?.businesses || []
  const content = contentData?.content || []

  const [filterBiz, setFilterBiz] = useState<number | 'all'>('all')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<ContentRow | null>(null)

  const filtered = useMemo(
    () => filterBiz === 'all' ? content : content.filter(c => c.business_id === filterBiz),
    [content, filterBiz]
  )

  const grouped = useMemo(() => {
    const map = new Map<number, ContentRow[]>()
    for (const c of filtered) {
      if (!map.has(c.business_id)) map.set(c.business_id, [])
      map.get(c.business_id)!.push(c)
    }
    return Array.from(map.entries())
  }, [filtered])

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this content item? This cannot be undone.')) return
    const res = await fetch(`/api/admin/onboarding/content/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    if (!res.ok) {
      alert('Failed to delete')
      return
    }
    mutate()
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Onboarding Content</h1>
          <p className="text-muted-foreground text-sm">
            Manage videos, documents, and articles assigned to each business.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setEditing(null); setShowForm(true) }}
          className="bg-primary text-primary-foreground px-4 py-2 rounded-md font-medium hover:opacity-90"
        >
          + Add Content
        </button>
      </div>

      {myPending > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <div className="text-sm">
            <span className="font-semibold">You have {myPending} onboarding item{myPending === 1 ? '' : 's'} to complete.</span>{' '}
            <span className="text-muted-foreground">
              This page manages content for everyone — your own training lives under My Onboarding.
            </span>
          </div>
          <Link
            href="/admin/my-onboarding"
            className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90 whitespace-nowrap"
          >
            🎓 Go to My Onboarding
          </Link>
        </div>
      )}

      {/* Filter */}
      <div className="mb-4">
        <select
          value={filterBiz}
          onChange={(e) => setFilterBiz(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          className="bg-card border border-border rounded-md px-3 py-2 text-sm"
        >
          <option value="all">All Businesses</option>
          {businesses.map(b => (
            <option key={b.id} value={b.id}>
              {b.location ? `${b.name} — ${b.location}` : b.name}
            </option>
          ))}
        </select>
      </div>

      {isLoading && (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-primary" />
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <div className="text-center py-12 text-muted-foreground bg-card rounded-lg border border-border">
          No content yet. Click <strong>+ Add Content</strong> to get started.
        </div>
      )}

      {!isLoading && grouped.map(([bizId, items]) => {
        const biz = businesses.find(b => b.id === bizId) || items[0]?.businesses
        const label = biz ? (biz.location ? `${biz.name} — ${biz.location}` : biz.name) : `Business #${bizId}`
        return (
          <div key={bizId} className="mb-6">
            <h2 className="font-semibold text-lg mb-2">{label}</h2>
            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="text-left p-3">Title</th>
                    <th className="text-left p-3 hidden sm:table-cell">Type</th>
                    <th className="text-left p-3 hidden md:table-cell">Required</th>
                    <th className="text-right p-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(c => (
                    <tr key={c.id} className="border-t border-border">
                      <td className="p-3">
                        <div className="font-medium">{c.title}</div>
                        {c.description && (
                          <div className="text-xs text-muted-foreground line-clamp-1">{c.description}</div>
                        )}
                      </td>
                      <td className="p-3 hidden sm:table-cell">
                        <span className="text-xs bg-muted px-2 py-0.5 rounded capitalize">
                          {c.type}{c.subtype ? ` (${c.subtype})` : ''}
                        </span>
                      </td>
                      <td className="p-3 hidden md:table-cell">
                        {c.is_required ? (
                          <span className="text-xs bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 px-2 py-0.5 rounded">Required</span>
                        ) : (
                          <span className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 px-2 py-0.5 rounded">Optional</span>
                        )}
                      </td>
                      <td className="p-3 text-right">
                        <button
                          type="button"
                          onClick={() => { setEditing(c); setShowForm(true) }}
                          className="text-primary hover:underline mr-3 text-xs sm:text-sm"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(c.id)}
                          className="text-destructive hover:underline text-xs sm:text-sm"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}

      {showForm && (
        <ContentFormModal
          businesses={businesses}
          editing={editing}
          onClose={() => { setShowForm(false); setEditing(null) }}
          onSaved={() => { setShowForm(false); setEditing(null); mutate() }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Form modal
// ---------------------------------------------------------------------------
// Sentinel values for the business selector. Negative numbers are used so they
// never collide with real business IDs (which are positive integers).
const ALL_BUSINESSES_VALUE = '__all__'
const ALL_OF_NAME_PREFIX = '__name__:'

function ContentFormModal({
  businesses,
  editing,
  onClose,
  onSaved,
}: {
  businesses: Business[]
  editing: ContentRow | null
  onClose: () => void
  onSaved: () => void
}) {
  // businessSelection is either a real business ID (number), '' (none),
  // ALL_BUSINESSES_VALUE, or `${ALL_OF_NAME_PREFIX}<name>`.
  const [businessSelection, setBusinessSelection] = useState<string>(
    editing?.business_id != null ? String(editing.business_id) : ''
  )
  const [type, setType] = useState<'video' | 'document' | 'article'>(editing?.type || 'video')
  const [subtype, setSubtype] = useState<string>(editing?.subtype || '')
  const [title, setTitle] = useState(editing?.title || '')
  const [description, setDescription] = useState(editing?.description || '')
  const [contentUrl, setContentUrl] = useState(editing?.content_url || '')
  const [contentText, setContentText] = useState(editing?.content_text || '')
  const [isRequired, setIsRequired] = useState(editing?.is_required ?? true)
  const [sortOrder, setSortOrder] = useState(editing?.sort_order ?? 0)
  const [durationSeconds, setDurationSeconds] = useState<number | null>(editing?.duration_seconds ?? null)
  const [fileSize, setFileSize] = useState<number | null>(editing?.file_size ?? null)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadStatus, setUploadStatus] = useState('')
  const [saving, setSaving] = useState(false)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadAbortRef = useRef<(() => void) | null>(null)

  const isEdit = !!editing
  const needsFile = type !== 'article'

  const handleAbortUpload = () => {
    if (uploadAbortRef.current) {
      uploadAbortRef.current()
      uploadAbortRef.current = null
      setUploading(false)
      setUploadStatus('Upload cancelled.')
      setUploadProgress(0)
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const maxSize = 500 * 1024 * 1024 // 500MB
    if (file.size > maxSize) {
      setErrMsg('File must be under 500MB.')
      return
    }

    setErrMsg(null)
    setUploading(true)
    setUploadProgress(0)
    setUploadStatus('Preparing upload…')

    // Detect duration in parallel with the upload (cheap, doesn't block)
    let detectedDuration: number | null = null
    const detected = SUBTYPE_FOR_MIME[file.type]
    const detectedType = detected?.type || (file.type.startsWith('video/') ? 'video' : 'document')
    const detectedSubtype = detected?.subtype
      || (file.type.startsWith('video/') ? 'video'
        : file.type.startsWith('audio/') ? 'audio'
        : file.type.startsWith('image/') ? 'image'
        : file.type === 'application/pdf' ? 'pdf'
        : 'pdf')

    // Auto-set type/subtype
    setType(detectedType as 'video' | 'document')
    setSubtype(detectedSubtype)

    // Probe duration for video/audio (best-effort, non-blocking for the upload)
    if (detectedType === 'video' || (detectedType === 'document' && detectedSubtype === 'audio')) {
      try {
        const objUrl = URL.createObjectURL(file)
        const media = detectedType === 'video' ? document.createElement('video') : document.createElement('audio')
        media.preload = 'metadata'
        media.src = objUrl
        await new Promise<void>((resolve) => {
          media.onloadedmetadata = () => resolve()
          media.onerror = () => resolve()
          setTimeout(() => resolve(), 5000)
        })
        if (media.duration && isFinite(media.duration)) {
          detectedDuration = Math.round(media.duration)
          setDurationSeconds(detectedDuration)
        }
        URL.revokeObjectURL(objUrl)
      } catch {
        // ignore
      }
    }

    // Sanitize file name: keep ext, replace spaces & special chars
    const ext = file.name.split('.').pop()?.toLowerCase() || 'bin'
    const safeBase = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50)
    const path = `${Date.now()}_${safeBase}.${ext}`

    try {
      if (shouldUseTus(file)) {
        // Resumable TUS upload for large videos. Survives network drops:
        // tus-js-client retries with backoff and resumes from the last byte.
        const { promise, abort } = resumableUpload({
          bucketName: 'onboarding-content',
          objectName: path,
          file,
          onProgress(pct) {
            setUploadProgress(pct)
            setUploadStatus(`Uploading… ${pct}%`)
          },
          onOffline(pct) {
            setUploadStatus(`No internet. ${pct}% uploaded — will resume when back online.`)
          },
          onOnline(pct) {
            setUploadStatus(`Reconnected. Resuming upload from ${pct}%…`)
          },
        })
        uploadAbortRef.current = abort
        await promise
        uploadAbortRef.current = null
      } else {
        // Direct upload for small files / non-videos with XHR-based progress
        await uploadWithProgress(file, path, 'onboarding-content', (pct) => {
          setUploadProgress(pct)
          setUploadStatus(`Uploading… ${pct}%`)
        })
      }

      const { data: pub } = supabase.storage.from('onboarding-content').getPublicUrl(path)
      setContentUrl(pub.publicUrl)
      setFileSize(file.size)
      setUploadProgress(100)
      setUploadStatus('Upload complete')
    } catch (e) {
      setUploadStatus('')
      setErrMsg(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
      uploadAbortRef.current = null
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // Resolve the dropdown selection to one or more business IDs.
  const resolveBusinessIds = (): number[] => {
    if (!businessSelection) return []
    if (businessSelection === ALL_BUSINESSES_VALUE) {
      return businesses.map(b => b.id)
    }
    if (businessSelection.startsWith(ALL_OF_NAME_PREFIX)) {
      const name = businessSelection.slice(ALL_OF_NAME_PREFIX.length)
      return businesses.filter(b => b.name === name).map(b => b.id)
    }
    const n = Number(businessSelection)
    return Number.isInteger(n) && n > 0 ? [n] : []
  }

  const handleSave = async () => {
    setErrMsg(null)
    const targetIds = resolveBusinessIds()
    if (targetIds.length === 0) { setErrMsg('Select a business'); return }
    if (isEdit && targetIds.length > 1) {
      setErrMsg('Cannot edit a single item across multiple locations. Pick one location.')
      return
    }
    if (!title.trim()) { setErrMsg('Title is required'); return }
    if (type === 'article' && !contentText.trim()) { setErrMsg('Article content is required'); return }
    if (type !== 'article' && !contentUrl) { setErrMsg('Upload a file or provide a URL'); return }

    setSaving(true)
    try {
      const basePayload = {
        type,
        // Articles have no subtype; videos always have subtype 'video'.
        subtype: type === 'article' ? null : (subtype || (type === 'video' ? 'video' : null)),
        title: title.trim(),
        description: description.trim() || null,
        // Mirror logic: file URL only applies to non-articles.
        content_url: type === 'article' ? null : (contentUrl || null),
        content_text: type === 'article' ? contentText : null,
        duration_seconds: type === 'article' ? null : durationSeconds,
        file_size: type === 'article' ? null : fileSize,
        is_required: isRequired,
        sort_order: sortOrder,
      }

      if (isEdit) {
        const res = await fetch(`/api/admin/onboarding/content/${editing!.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ ...basePayload, business_id: targetIds[0] }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || 'Save failed')
      } else {
        const res = await fetch('/api/admin/onboarding/content', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ ...basePayload, business_ids: targetIds }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || 'Save failed')
      }
      onSaved()
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-3 overflow-y-auto">
      <div className="bg-card rounded-lg w-full max-w-2xl my-8 max-h-[90vh] flex flex-col">
        <div className="p-5 border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-bold">{isEdit ? 'Edit Content' : 'Add Onboarding Content'}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {errMsg && <div className="bg-destructive/10 text-destructive p-3 rounded-md text-sm">{errMsg}</div>}

          <div>
            <label className="block text-sm font-medium mb-1">Business *</label>
            <select
              value={businessSelection}
              onChange={(e) => setBusinessSelection(e.target.value)}
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
            >
              <option value="">Select a business…</option>
              {!isEdit && businesses.length > 1 && (
                <option value={ALL_BUSINESSES_VALUE}>
                  All Locations (every business)
                </option>
              )}
              {!isEdit && (() => {
                // Group: for each unique business name with 2+ locations,
                // offer an "All <name> locations" shortcut.
                const counts = new Map<string, number>()
                for (const b of businesses) {
                  counts.set(b.name, (counts.get(b.name) || 0) + 1)
                }
                return Array.from(counts.entries())
                  .filter(([, c]) => c > 1)
                  .map(([name]) => (
                    <option key={`all-${name}`} value={`${ALL_OF_NAME_PREFIX}${name}`}>
                      All {name} locations
                    </option>
                  ))
              })()}
              {businesses.map(b => (
                <option key={b.id} value={String(b.id)}>
                  {b.location ? `${b.name} — ${b.location}` : b.name}
                </option>
              ))}
            </select>
            {!isEdit && businessSelection && (
              businessSelection === ALL_BUSINESSES_VALUE
              || businessSelection.startsWith(ALL_OF_NAME_PREFIX)
            ) && (
              <p className="text-xs text-muted-foreground mt-1">
                A separate copy will be created for each location.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Type *</label>
              <select
                value={type}
                onChange={(e) => {
                  const t = e.target.value as 'video' | 'document' | 'article'
                  setType(t)
                  if (t === 'video') setSubtype('video')
                  if (t === 'article') setSubtype('')
                }}
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              >
                <option value="video">Video</option>
                <option value="document">Document</option>
                <option value="article">Article (rich text)</option>
              </select>
            </div>

            {type === 'document' && (
              <div>
                <label className="block text-sm font-medium mb-1">Document type</label>
                <select
                  value={subtype}
                  onChange={(e) => setSubtype(e.target.value)}
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                >
                  <option value="">Auto-detect</option>
                  <option value="pdf">PDF</option>
                  <option value="image">Image</option>
                  <option value="docx">Word (DOCX)</option>
                  <option value="audio">Audio</option>
                  <option value="video">Video</option>
                </select>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              maxLength={200}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              rows={2}
              maxLength={500}
            />
          </div>

          {needsFile && (
            <div>
              <label className="block text-sm font-medium mb-1">
                File {!contentUrl && '*'}
              </label>
              {contentUrl && (
                <div className="text-xs text-muted-foreground mb-2 break-all">
                  Current: {contentUrl}
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileChange}
                disabled={uploading}
                accept="video/*,audio/*,image/*,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword"
                className="block w-full text-sm file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-primary file:text-primary-foreground hover:file:opacity-90 disabled:opacity-50"
              />

              {uploading && (
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-muted-foreground">{uploadStatus || 'Uploading…'}</span>
                    <span className="text-xs font-medium tabular-nums">{uploadProgress}%</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-primary h-2 rounded-full transition-all"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleAbortUpload}
                    className="mt-2 text-xs text-destructive hover:underline"
                  >
                    Cancel upload
                  </button>
                </div>
              )}

              {!uploading && uploadProgress === 100 && contentUrl && (
                <div className="mt-2 text-xs text-green-700 dark:text-green-400">
                  ✓ Uploaded ({fileSize ? (fileSize / 1024 / 1024).toFixed(1) : '?'} MB
                  {durationSeconds ? `, ${Math.floor(durationSeconds / 60)}:${String(durationSeconds % 60).padStart(2, '0')}` : ''})
                </div>
              )}

              {!uploading && uploadStatus && uploadProgress < 100 && (
                <div className="mt-2 text-xs text-muted-foreground">{uploadStatus}</div>
              )}
            </div>
          )}

          {type === 'article' && (
            <div>
              <label className="block text-sm font-medium mb-1">Article Content *</label>
              <RichTextEditor value={contentText} onChange={setContentText} />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={isRequired}
                  onChange={(e) => setIsRequired(e.target.checked)}
                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                />
                Required for completion
              </label>
              <p className="text-xs text-muted-foreground mt-1">
                Required items must be completed for onboarding to finish.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Sort order</label>
              <input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(Number(e.target.value) || 0)}
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              />
            </div>
          </div>
        </div>

        <div className="p-5 border-t border-border flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium hover:bg-accent rounded-md"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || uploading}
            className="bg-primary text-primary-foreground px-5 py-2 rounded-md font-medium hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
