'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface SearchResult {
  id: string
  kind: 'onboarding' | 'policy'
  type: string
  title: string
  preview: string
  href: string
  badge: string | null
}

const KIND_META: Record<string, { emoji: string; label: string; tint: string }> = {
  video: { emoji: '🎥', label: 'Video', tint: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' },
  document: { emoji: '📄', label: 'Document', tint: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  article: { emoji: '📝', label: 'Article', tint: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  policy: { emoji: '📑', label: 'Policy', tint: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' },
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!text || !query) return text
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return text
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-amber-200/60 dark:bg-amber-500/30 text-foreground rounded px-0.5">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  )
}

const SUGGESTED_QUERIES = ['Refund policy', 'Split payment', 'Exchange', 'Clock in', 'Onboarding']

export default function KnowledgePage() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      setError(null)
      return
    }

    let cancelled = false
    const timer = setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/knowledge/search?q=${encodeURIComponent(q)}`, {
          credentials: 'include',
        })
        const json = await res.json()
        if (cancelled) return
        if (!res.ok) throw new Error(json.error || 'Search failed')
        setResults(json.results || [])
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Search failed')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 300)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  const trimmedQuery = query.trim()

  return (
    <div className="max-w-3xl mx-auto">
      {/* Hero */}
      <div className="text-center mb-6 sm:mb-8">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-600 text-white text-2xl shadow-lg shadow-purple-500/30 mb-3">
          🔍
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-1">Knowledge Base</h1>
        <p className="text-muted-foreground text-sm sm:text-base">
          Search training guides, documents, and policies.
        </p>
      </div>

      {/* Search box */}
      <div className="relative mb-6 group">
        <div className="absolute inset-0 bg-gradient-to-r from-purple-500/20 to-indigo-500/20 rounded-2xl blur-xl opacity-0 group-focus-within:opacity-100 transition-opacity pointer-events-none" />
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search… e.g. split payment, refund policy"
            className="w-full bg-card border-2 border-border rounded-2xl px-12 py-4 text-base focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all shadow-sm"
            autoFocus
          />
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground text-lg pointer-events-none">🔍</span>
          {loading ? (
            <div className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
          ) : query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive p-3 rounded-xl mb-4 text-sm">{error}</div>
      )}

      {/* Empty state with suggestions */}
      {trimmedQuery.length < 2 && (
        <div className="text-center py-8">
          <p className="text-sm text-muted-foreground mb-4">Try searching for…</p>
          <div className="flex flex-wrap justify-center gap-2">
            {SUGGESTED_QUERIES.map(s => (
              <button
                key={s}
                type="button"
                onClick={() => setQuery(s)}
                className="text-sm bg-card border border-border rounded-full px-4 py-1.5 hover:border-primary hover:bg-primary/5 transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* No results */}
      {trimmedQuery.length >= 2 && !loading && results.length === 0 && !error && (
        <div className="text-center py-12 bg-card border border-border rounded-2xl">
          <div className="text-4xl mb-2">🤷</div>
          <p className="text-muted-foreground">
            No results for <span className="font-medium text-foreground">&ldquo;{trimmedQuery}&rdquo;</span>
          </p>
          <p className="text-xs text-muted-foreground mt-1">Try different keywords</p>
        </div>
      )}

      {/* Results */}
      <div className="space-y-3">
        {results.map((r) => {
          const meta = KIND_META[r.type] || KIND_META.document
          return (
            <Link
              key={`${r.kind}-${r.id}`}
              href={r.href}
              className="group flex items-start gap-3 bg-card border border-border rounded-xl p-4 hover:border-primary/40 hover:shadow-md transition-all"
            >
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg flex-shrink-0 ${meta.tint}`}>
                {meta.emoji}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <h3 className="font-semibold leading-tight">{highlightMatch(r.title, trimmedQuery)}</h3>
                  <span className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
                    {meta.label}
                  </span>
                </div>
                {r.badge && (
                  <p className="text-xs text-muted-foreground mb-1">{r.badge}</p>
                )}
                {r.preview && (
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {highlightMatch(r.preview, trimmedQuery)}
                  </p>
                )}
              </div>
              <span className="text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all">→</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
