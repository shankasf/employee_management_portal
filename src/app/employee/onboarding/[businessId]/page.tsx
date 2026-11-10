'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useOnboardingBasePath } from '@/lib/hooks/useOnboardingBasePath'
import useSWR from 'swr'

interface ContentItem {
  id: string
  business_id: number
  type: 'video' | 'document' | 'article'
  subtype: string | null
  title: string
  description: string | null
  content_url: string | null
  is_required: boolean
  duration_seconds: number | null
  progress: { max_watched_pct: number; completed_at: string | null }
}

interface ApiResponse {
  business: { id: number; name: string; location: string | null } | null
  items: ContentItem[]
  completion: { completed_at: string } | null
}

const fetcher = async (url: string) => {
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<ApiResponse>
}

function brandGradient(name: string): string {
  const palettes = [
    'from-indigo-500 to-purple-600',
    'from-blue-500 to-cyan-600',
    'from-emerald-500 to-teal-600',
    'from-amber-500 to-orange-600',
    'from-pink-500 to-rose-600',
    'from-violet-500 to-fuchsia-600',
  ]
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) & 0xffffffff
  return palettes[Math.abs(hash) % palettes.length]
}

function typeIcon(item: ContentItem): { emoji: string; label: string; bg: string } {
  if (item.type === 'video') return { emoji: '🎥', label: 'Video', bg: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' }
  if (item.type === 'article') return { emoji: '📝', label: 'Article', bg: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' }
  if (item.subtype === 'pdf') return { emoji: '📄', label: 'PDF', bg: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' }
  if (item.subtype === 'image') return { emoji: '🖼️', label: 'Image', bg: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/40 dark:text-fuchsia-300' }
  if (item.subtype === 'audio') return { emoji: '🎧', label: 'Audio', bg: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' }
  if (item.subtype === 'docx') return { emoji: '📑', label: 'Word', bg: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' }
  if (item.subtype === 'video') return { emoji: '🎬', label: 'Video', bg: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' }
  return { emoji: '📎', label: 'Document', bg: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' }
}

function statusBadge(item: ContentItem) {
  if (item.progress.completed_at) {
    return (
      <span className="text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 px-2 py-1 rounded-full whitespace-nowrap">
        ✅ Completed
      </span>
    )
  }
  if (item.progress.max_watched_pct > 0) {
    return (
      <span className="text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 px-2 py-1 rounded-full whitespace-nowrap">
        ⏳ {Math.round(item.progress.max_watched_pct)}%
      </span>
    )
  }
  return (
    <span className="text-xs font-medium bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 px-2 py-1 rounded-full whitespace-nowrap">
      Not started
    </span>
  )
}

export default function BusinessOnboardingPage() {
  const params = useParams<{ businessId: string }>()
  const router = useRouter()
  const businessId = Number(params?.businessId)
  const { user } = useAuth()
  const basePath = useOnboardingBasePath()
  const [finalizing, setFinalizing] = useState(false)
  const [finalizeError, setFinalizeError] = useState<string | null>(null)

  const swrKey = user?.id && businessId ? `/api/onboarding/content?business_id=${businessId}` : null
  const { data, error, isLoading, mutate } = useSWR<ApiResponse>(swrKey, fetcher)

  const grouped = useMemo(() => {
    const items = data?.items || []
    return {
      videos: items.filter(i => i.type === 'video'),
      documents: items.filter(i => i.type === 'document'),
      articles: items.filter(i => i.type === 'article'),
    }
  }, [data])

  const stats = useMemo(() => {
    const items = data?.items || []
    const required = items.filter(i => i.is_required)
    const completedRequired = required.filter(i => i.progress.completed_at).length
    return {
      requiredTotal: required.length,
      requiredCompleted: completedRequired,
      pct: required.length === 0 ? (items.length === 0 ? 0 : 100) : Math.round((completedRequired / required.length) * 100),
      allRequiredDone: items.length > 0 && (required.length === 0 || completedRequired === required.length),
    }
  }, [data])

  const handleFinalize = async () => {
    setFinalizing(true)
    setFinalizeError(null)
    try {
      const res = await fetch('/api/onboarding/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ business_id: businessId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to complete')
      await mutate()
    } catch (e) {
      setFinalizeError(e instanceof Error ? e.message : 'Failed to complete')
    } finally {
      setFinalizing(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-primary" />
      </div>
    )
  }

  if (error || !data?.business) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-destructive/10 text-destructive p-4 rounded-md">
          {error instanceof Error ? error.message : 'Failed to load onboarding'}
        </div>
        <Link href={basePath} className="text-primary mt-4 inline-block">← Back</Link>
      </div>
    )
  }

  const biz = data.business
  const welcomeText = biz.location
    ? `Welcome to ${biz.name} — ${biz.location}`
    : `Welcome to ${biz.name}`
  const gradient = brandGradient(biz.name)
  const totalItems = data.items.length

  return (
    <div className="max-w-4xl mx-auto">
      {/* Hero header */}
      <div className={`relative bg-gradient-to-br ${gradient} rounded-2xl p-6 sm:p-8 mb-6 text-white shadow-lg overflow-hidden`}>
        {/* Decorative blobs */}
        <div className="absolute -top-24 -right-24 w-64 h-64 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-24 -left-24 w-64 h-64 rounded-full bg-white/10 blur-3xl" />

        <div className="relative">
          <Link
            href={basePath}
            className="text-white/80 hover:text-white text-sm inline-flex items-center gap-1 mb-3 transition-colors"
          >
            ← Switch company
          </Link>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-1">{welcomeText}</h1>
          <p className="text-white/80 text-sm sm:text-base">
            Complete your onboarding to get started.
          </p>

          {!data.completion && totalItems > 0 && (
            <div className="mt-5 bg-white/10 backdrop-blur rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-white/90">Your progress</span>
                <span className="text-2xl font-bold tabular-nums">{stats.pct}%</span>
              </div>
              <div className="w-full bg-white/20 rounded-full h-2.5 overflow-hidden">
                <div
                  className="bg-white h-2.5 rounded-full transition-all duration-700"
                  style={{ width: `${stats.pct}%` }}
                />
              </div>
              <p className="text-xs text-white/80 mt-2">
                {stats.requiredCompleted} of {stats.requiredTotal} required item{stats.requiredTotal === 1 ? '' : 's'} completed
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Completion banner */}
      {data.completion && (
        <div className="bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-900/20 dark:to-teal-900/20 border border-emerald-200 dark:border-emerald-800 rounded-2xl p-6 mb-6 text-center shadow-sm">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-emerald-500 text-white text-3xl mb-3 shadow-lg shadow-emerald-500/30">
            ✓
          </div>
          <h2 className="text-xl font-bold text-emerald-800 dark:text-emerald-300 mb-1">
            Onboarding Completed
          </h2>
          <p className="text-sm text-emerald-700 dark:text-emerald-400">
            Completed on {new Date(data.completion.completed_at).toLocaleDateString('en-US', {
              year: 'numeric', month: 'long', day: 'numeric',
            })}
          </p>
        </div>
      )}

      {/* Finalize CTA */}
      {!data.completion && stats.allRequiredDone && (
        <div className="bg-card border-2 border-primary/30 rounded-2xl p-5 mb-6 text-center">
          <p className="text-sm text-muted-foreground mb-3">
            🎉 You&apos;ve completed all required items. Click below to mark your onboarding as complete.
          </p>
          {finalizeError && (
            <div className="text-sm text-destructive mb-3">{finalizeError}</div>
          )}
          <button
            type="button"
            onClick={handleFinalize}
            disabled={finalizing}
            className="bg-primary text-primary-foreground px-6 py-3 rounded-xl font-semibold hover:opacity-90 disabled:opacity-50 shadow-md shadow-primary/30 transition-all hover:shadow-lg hover:-translate-y-0.5"
          >
            {finalizing ? 'Finalizing…' : 'Mark Onboarding as Complete'}
          </button>
        </div>
      )}

      {/* Content sections */}
      {(['videos', 'documents', 'articles'] as const).map(group => {
        const items = grouped[group]
        if (items.length === 0) return null
        const headers = {
          videos: { icon: '🎥', label: 'Videos' },
          documents: { icon: '📄', label: 'Documents' },
          articles: { icon: '📝', label: 'Articles' },
        }
        return (
          <div key={group} className="mb-6">
            <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
              <span>{headers[group].icon}</span>
              <span>{headers[group].label}</span>
              <span className="text-xs font-normal text-muted-foreground ml-1">{items.length}</span>
            </h3>
            <div className="space-y-2">
              {items.map(item => {
                const ti = typeIcon(item)
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => router.push(`${basePath}/${businessId}/${item.id}`)}
                    className="group w-full text-left bg-card border border-border rounded-xl p-4 hover:border-primary/40 hover:shadow-md transition-all focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-11 h-11 rounded-lg flex items-center justify-center text-xl flex-shrink-0 ${ti.bg}`}>
                        {ti.emoji}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h4 className="font-medium leading-tight">{item.title}</h4>
                          {!item.is_required && (
                            <span className="text-[10px] uppercase tracking-wide font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 px-1.5 py-0.5 rounded">
                              Optional
                            </span>
                          )}
                        </div>
                        {item.description && (
                          <p className="text-sm text-muted-foreground line-clamp-2">{item.description}</p>
                        )}
                      </div>
                      <div className="flex-shrink-0 flex flex-col items-end gap-2">
                        {statusBadge(item)}
                        <span className="text-xs text-primary opacity-0 group-hover:opacity-100 transition-opacity">→</span>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}

      {totalItems === 0 && (
        <div className="text-center py-16 bg-card border border-border rounded-2xl">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-muted text-3xl mb-3">
            📭
          </div>
          <p className="text-muted-foreground">No onboarding content has been assigned yet.</p>
        </div>
      )}
    </div>
  )
}
