'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useOnboardingBasePath } from '@/lib/hooks/useOnboardingBasePath'
import useSWR from 'swr'
import { RichTextDisplay } from '@/components/RichTextEditor'
import { VideoPlayer } from '@/components/VideoPlayer'
import { getMediaSrc } from '@/lib/storage-path'

interface ContentItem {
  id: string
  business_id: number
  type: 'video' | 'document' | 'article'
  subtype: string | null
  title: string
  description: string | null
  content_url: string | null
  content_text: string | null
  duration_seconds: number | null
  is_required: boolean
  progress: { max_watched_pct: number; completed_at: string | null }
}

interface ApiResponse {
  business: { id: number; name: string; location: string | null } | null
  items: ContentItem[]
}

const fetcher = async (url: string) => {
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<ApiResponse>
}

export default function ContentViewerPage() {
  const params = useParams<{ businessId: string; contentId: string }>()
  const router = useRouter()
  const businessId = Number(params?.businessId)
  const contentId = params?.contentId
  const { user } = useAuth()
  const basePath = useOnboardingBasePath()

  const swrKey = user?.id && businessId ? `/api/onboarding/content?business_id=${businessId}` : null
  const { data, error, isLoading, mutate } = useSWR<ApiResponse>(swrKey, fetcher)

  const item = useMemo(
    () => data?.items.find(i => i.id === contentId) || null,
    [data, contentId]
  )

  // onboarding-content is a private bucket, so what's stored in content_url is
  // not directly fetchable. Resolve it to the authenticated media proxy for
  // rendering; externally pasted links pass through unchanged. The stored value
  // itself is left alone - the admin API keys deletions off it.
  const mediaSrc = useMemo(
    () => getMediaSrc('onboarding-content', item?.content_url),
    [item?.content_url]
  )

  const [confirmed, setConfirmed] = useState(false)
  const [maxWatched, setMaxWatched] = useState(0)
  const [saving, setSaving] = useState(false)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const lastSavedPctRef = useRef(0)

  // Sync state when item loads
  useEffect(() => {
    if (item) {
      setMaxWatched(item.progress.max_watched_pct)
      lastSavedPctRef.current = item.progress.max_watched_pct
      setConfirmed(!!item.progress.completed_at)
    }
  }, [item])

  // Throttled save of watched %
  const saveProgress = async (watchedPct: number, markComplete = false) => {
    if (!item) return
    try {
      setSaving(true)
      setErrMsg(null)
      const res = await fetch('/api/onboarding/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          content_id: item.id,
          watched_pct: watchedPct,
          mark_complete: markComplete,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to save')
      if (typeof json.max_watched_pct === 'number') {
        setMaxWatched(json.max_watched_pct)
        lastSavedPctRef.current = json.max_watched_pct
      }
      if (markComplete && json.completed_at) {
        await mutate()
      }
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  // Video / audio time-update handler
  const handleTimeUpdate = (el: HTMLMediaElement) => {
    if (!el.duration || !isFinite(el.duration)) return
    const pct = Math.min(100, Math.max(0, (el.currentTime / el.duration) * 100))
    if (pct > maxWatched) setMaxWatched(pct)
    // Save every +5% to reduce noise
    if (pct - lastSavedPctRef.current >= 5) {
      lastSavedPctRef.current = pct
      saveProgress(pct)
    }
  }

  // On unmount / nav-away, persist final position
  useEffect(() => {
    return () => {
      const el = videoRef.current || audioRef.current
      if (el && el.duration && isFinite(el.duration)) {
        const pct = Math.min(100, (el.currentTime / el.duration) * 100)
        if (pct > lastSavedPctRef.current) {
          // best-effort beacon-style fetch
          try {
            const blob = new Blob([JSON.stringify({
              content_id: contentId,
              watched_pct: pct,
            })], { type: 'application/json' })
            navigator.sendBeacon?.('/api/onboarding/progress', blob)
          } catch {
            // ignore
          }
        }
      }
    }
  }, [contentId])

  const handleMarkComplete = async () => {
    if (!item) return
    if (item.type === 'video' && maxWatched < 90) {
      setErrMsg('Please watch at least 90% of the video before marking complete.')
      return
    }
    await saveProgress(maxWatched, true)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-primary" />
      </div>
    )
  }

  if (error || !item) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-destructive/10 text-destructive p-4 rounded-md mb-4">
          {error instanceof Error ? error.message : 'Content not found'}
        </div>
        <Link href={`${basePath}/${businessId}`} className="text-primary">← Back to dashboard</Link>
      </div>
    )
  }

  const isComplete = !!item.progress.completed_at
  const checkboxText = item.type === 'video'
    ? 'I watched and understood this'
    : 'I read and understood this'
  const canCheck = item.type === 'video' ? maxWatched >= 90 : true

  // Pick a header tint per content type
  const headerTint =
    item.type === 'video' ? 'from-rose-500 to-orange-500' :
    item.type === 'article' ? 'from-blue-500 to-cyan-500' :
    item.subtype === 'pdf' ? 'from-red-500 to-pink-500' :
    item.subtype === 'image' ? 'from-fuchsia-500 to-purple-500' :
    item.subtype === 'audio' ? 'from-purple-500 to-violet-500' :
    item.subtype === 'docx' ? 'from-blue-500 to-indigo-500' :
    'from-slate-500 to-slate-600'

  const typeLabel =
    item.type === 'video' ? 'Video' :
    item.type === 'article' ? 'Article' :
    item.subtype === 'pdf' ? 'PDF Document' :
    item.subtype === 'image' ? 'Image' :
    item.subtype === 'audio' ? 'Audio' :
    item.subtype === 'docx' ? 'Word Document' :
    item.subtype === 'video' ? 'Video' :
    'Document'

  return (
    <div className="max-w-4xl mx-auto">
      <Link href={`${basePath}/${businessId}`} className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-4 transition-colors">
        ← Back to onboarding
      </Link>

      <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
        {/* Title + status */}
        <div className={`relative bg-gradient-to-br ${headerTint} p-5 sm:p-6 text-white overflow-hidden`}>
          <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full bg-white/10 blur-2xl" />
          <div className="relative">
            <div className="flex items-start justify-between gap-3 mb-1">
              <div className="flex-1 min-w-0">
                <span className="inline-block text-[10px] uppercase tracking-wider font-semibold bg-white/20 px-2 py-0.5 rounded-full mb-2">
                  {typeLabel}{!item.is_required && ' · Optional'}
                </span>
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight leading-tight">{item.title}</h1>
              </div>
              {isComplete && (
                <span className="text-xs font-medium bg-white text-emerald-700 px-2 py-1 rounded-full flex-shrink-0 shadow-sm">
                  ✅ Completed
                </span>
              )}
            </div>
            {item.description && (
              <p className="text-white/90 text-sm sm:text-base mt-2">{item.description}</p>
            )}
          </div>
        </div>

        {/* Player / viewer */}
        <div className="p-5">
          {item.type === 'video' && mediaSrc && (
            <div>
              <VideoPlayer
                ref={videoRef}
                src={mediaSrc}
                className="w-full max-h-[70vh]"
                onTimeUpdate={(e) => handleTimeUpdate(e.currentTarget)}
                onEnded={(e) => {
                  const el = e.currentTarget
                  if (el.duration && isFinite(el.duration)) {
                    saveProgress(100)
                  }
                }}
              />
              <div className="mt-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs sm:text-sm font-medium text-muted-foreground">Watched</span>
                  <span className="text-xs sm:text-sm font-bold tabular-nums">{Math.round(maxWatched)}%</span>
                </div>
                <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                  <div
                    className={`h-1.5 rounded-full transition-all duration-500 ${maxWatched >= 90 ? 'bg-emerald-500' : 'bg-primary'}`}
                    style={{ width: `${maxWatched}%` }}
                  />
                </div>
                {maxWatched < 90 && !isComplete && (
                  <p className="text-xs text-muted-foreground mt-1.5">
                    Watch at least 90% before marking complete
                  </p>
                )}
              </div>
            </div>
          )}

          {item.type === 'document' && mediaSrc && item.subtype === 'pdf' && (
            <div>
              {/* Desktop / larger screens: inline iframe preview */}
              <iframe
                src={mediaSrc}
                className="hidden md:block w-full h-[75vh] border border-border rounded-md"
                title={item.title}
              />
              {/* Mobile: iframe PDF viewing is unreliable (iOS Safari only shows page 1),
                  so show a clear open-in-new-tab card instead */}
              <div className="md:hidden bg-muted p-6 rounded-md text-center">
                <div className="text-4xl mb-3" aria-hidden>📄</div>
                <p className="text-muted-foreground mb-4 text-sm">
                  For the best experience on mobile, tap below to open the PDF.
                </p>
                <a
                  href={mediaSrc}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block bg-primary text-primary-foreground px-5 py-3 rounded-md font-medium hover:opacity-90"
                >
                  Open PDF
                </a>
              </div>
              {/* Desktop fallback link in case the iframe fails to load */}
              <div className="hidden md:block mt-3 text-center">
                <a
                  href={mediaSrc}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline"
                >
                  Open PDF in new tab
                </a>
              </div>
            </div>
          )}

          {item.type === 'document' && mediaSrc && item.subtype === 'image' && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={mediaSrc}
              alt={item.title}
              className="w-full max-h-[80vh] object-contain rounded-md"
            />
          )}

          {item.type === 'document' && mediaSrc && item.subtype === 'audio' && (
            <audio
              ref={audioRef}
              src={mediaSrc}
              controls
              className="w-full"
              onTimeUpdate={(e) => handleTimeUpdate(e.currentTarget)}
            />
          )}

          {item.type === 'document' && mediaSrc && item.subtype === 'video' && (
            <VideoPlayer
              ref={videoRef}
              src={mediaSrc}
              className="w-full max-h-[70vh]"
              onTimeUpdate={(e) => handleTimeUpdate(e.currentTarget)}
            />
          )}

          {item.type === 'document' && mediaSrc && item.subtype === 'docx' && (
            <div className="bg-muted p-6 rounded-md text-center">
              <p className="text-muted-foreground mb-3">
                This document is a Word file. Click below to open it in a new tab.
              </p>
              <a
                href={mediaSrc}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block bg-primary text-primary-foreground px-4 py-2 rounded-md font-medium hover:opacity-90"
              >
                Open Document
              </a>
            </div>
          )}

          {item.type === 'article' && item.content_text && (
            <div className="prose prose-sm sm:prose dark:prose-invert max-w-none">
              <RichTextDisplay content={item.content_text} />
            </div>
          )}
        </div>

        {/* Confirmation footer */}
        <div className="p-5 border-t border-border bg-muted/40">
          {errMsg && (
            <div className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md mb-3">{errMsg}</div>
          )}

          <label className={`flex items-start gap-3 cursor-pointer select-none p-3 rounded-xl border-2 transition-colors ${
            confirmed
              ? 'border-primary/40 bg-primary/5'
              : !canCheck && !isComplete
                ? 'border-border opacity-60 cursor-not-allowed'
                : 'border-border hover:border-primary/30'
          }`}>
            <input
              type="checkbox"
              className="mt-0.5 h-5 w-5 rounded border-border text-primary focus:ring-primary"
              checked={confirmed}
              disabled={isComplete || !canCheck}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span className="text-sm sm:text-base font-medium">
              {checkboxText}
            </span>
          </label>

          {!isComplete && (
            <button
              type="button"
              onClick={handleMarkComplete}
              disabled={!confirmed || !canCheck || saving}
              className="mt-4 w-full sm:w-auto bg-primary text-primary-foreground px-6 py-3 rounded-xl font-semibold hover:opacity-90 disabled:opacity-50 shadow-md shadow-primary/30 transition-all hover:shadow-lg hover:-translate-y-0.5 disabled:transform-none disabled:shadow-none"
            >
              {saving ? 'Saving…' : '✓ Mark as Completed'}
            </button>
          )}

          {isComplete && (
            <button
              type="button"
              onClick={() => router.push(`${basePath}/${businessId}`)}
              className="mt-4 w-full sm:w-auto bg-primary text-primary-foreground px-6 py-3 rounded-xl font-semibold hover:opacity-90 shadow-md transition-all hover:-translate-y-0.5"
            >
              ← Back to Dashboard
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
