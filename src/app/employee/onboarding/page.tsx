'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useOnboardingBasePath } from '@/lib/hooks/useOnboardingBasePath'
import useSWR from 'swr'

interface BusinessRow {
  business_id: number
  name: string
  location: string | null
  required_total: number
  required_completed: number
  progress_pct: number
  is_completed: boolean
  completed_at: string | null
}

const fetcher = async (url: string) => {
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// Pick a brand color for each business name so each card feels distinct.
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

function brandInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase())
    .join('')
}

export default function OnboardingEntryPage() {
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const basePath = useOnboardingBasePath()
  const [redirected, setRedirected] = useState(false)

  const { data, error, isLoading } = useSWR(
    user?.id ? '/api/onboarding/businesses' : null,
    fetcher
  )

  const businesses: BusinessRow[] = data?.businesses || []

  useEffect(() => {
    if (!isLoading && !redirected && businesses.length === 1) {
      setRedirected(true)
      router.replace(`${basePath}/${businesses[0].business_id}`)
    }
  }, [businesses, isLoading, redirected, router, basePath])

  if (authLoading || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-primary" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-destructive/10 text-destructive p-4 rounded-md">
          Failed to load onboarding. Please refresh.
        </div>
      </div>
    )
  }

  if (businesses.length === 0) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-indigo-500/10 to-purple-500/10 text-4xl mb-4">
          📚
        </div>
        <h1 className="text-2xl font-bold mb-2">No Onboarding Available</h1>
        <p className="text-muted-foreground">
          You haven&apos;t been assigned to any company yet. Please contact your manager.
        </p>
      </div>
    )
  }

  if (businesses.length === 1) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-primary" />
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Hero */}
      <div className="text-center mb-10">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white text-3xl shadow-lg shadow-indigo-500/30 mb-4">
          📚
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold mb-2 tracking-tight">
          Select where you are working
        </h1>
        <p className="text-muted-foreground text-sm sm:text-base">
          Choose a company to view its onboarding dashboard.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {businesses.map(b => {
          const label = b.location ? `${b.name} — ${b.location}` : b.name
          const gradient = brandGradient(b.name)
          const initials = brandInitials(b.name)
          return (
            <button
              key={b.business_id}
              type="button"
              onClick={() => router.push(`${basePath}/${b.business_id}`)}
              className="group relative text-left bg-card border border-border rounded-2xl p-5 hover:shadow-xl hover:-translate-y-0.5 hover:border-primary/40 transition-all focus:outline-none focus:ring-2 focus:ring-primary overflow-hidden"
            >
              {/* Decorative gradient blob */}
              <div className={`absolute -top-12 -right-12 w-32 h-32 rounded-full bg-gradient-to-br ${gradient} opacity-10 group-hover:opacity-20 transition-opacity`} />

              <div className="relative">
                <div className="flex items-start gap-3 mb-4">
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${gradient} text-white font-bold text-base flex items-center justify-center shadow-md flex-shrink-0`}>
                    {initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="font-semibold text-base sm:text-lg leading-tight">{b.name}</h2>
                    {b.location && (
                      <p className="text-xs text-muted-foreground mt-0.5">{b.location}</p>
                    )}
                  </div>
                  {b.is_completed ? (
                    <span className="text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 px-2 py-1 rounded-full whitespace-nowrap">
                      ✅ Done
                    </span>
                  ) : b.progress_pct > 0 ? (
                    <span className="text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 px-2 py-1 rounded-full whitespace-nowrap">
                      ⏳ {b.progress_pct}%
                    </span>
                  ) : (
                    <span className="text-xs font-medium bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 px-2 py-1 rounded-full whitespace-nowrap">
                      New
                    </span>
                  )}
                </div>

                <div className="w-full bg-muted rounded-full h-2 overflow-hidden mb-2">
                  <div
                    className={`bg-gradient-to-r ${gradient} h-2 rounded-full transition-all duration-500`}
                    style={{ width: `${b.progress_pct}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{b.required_completed} of {b.required_total} required</span>
                  <span className="font-medium tabular-nums">{b.progress_pct}%</span>
                </div>

                {/* CTA arrow on hover */}
                <div className="mt-3 text-xs font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                  {b.is_completed ? 'Review' : 'Continue'} <span aria-hidden>→</span>
                </div>
              </div>

              <span className="sr-only">{label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
