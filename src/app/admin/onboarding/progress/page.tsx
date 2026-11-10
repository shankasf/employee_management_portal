'use client'

import { useMemo, useState } from 'react'
import useSWR from 'swr'

interface Row {
  employee_id: string
  employee_name: string
  employee_email: string | null
  business_id: number
  business_name: string
  business_location: string | null
  required_total: number
  items_total: number
  required_completed: number
  items_completed: number
  progress_pct: number
  is_completed: boolean
  completed_at: string | null
  acknowledged: boolean
}

const fetcher = async (url: string) => {
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<{ rows: Row[] }>
}

export default function AdminOnboardingProgressPage() {
  const { data, isLoading, mutate } = useSWR('/api/admin/onboarding/progress', fetcher, {
    refreshInterval: 60_000,
  })
  const [filter, setFilter] = useState<'all' | 'incomplete' | 'completed' | 'unack'>('all')
  const [bizFilter, setBizFilter] = useState<number | 'all'>('all')

  const rows = data?.rows || []

  const businesses = useMemo(() => {
    const map = new Map<number, string>()
    for (const r of rows) {
      const label = r.business_location ? `${r.business_name} — ${r.business_location}` : r.business_name
      map.set(r.business_id, label)
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]))
  }, [rows])

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (bizFilter !== 'all' && r.business_id !== bizFilter) return false
      if (filter === 'incomplete' && r.is_completed) return false
      if (filter === 'completed' && !r.is_completed) return false
      if (filter === 'unack' && (r.acknowledged || !r.is_completed)) return false
      return true
    })
  }, [rows, filter, bizFilter])

  const unackCount = rows.filter(r => r.is_completed && !r.acknowledged).length

  const handleAck = async (employeeId: string, businessId: number) => {
    const res = await fetch('/api/admin/onboarding/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ employee_id: employeeId, business_id: businessId }),
    })
    if (!res.ok) {
      alert('Failed to acknowledge')
      return
    }
    mutate()
  }

  const handleAckAll = async () => {
    if (!confirm(`Acknowledge ${unackCount} new completion${unackCount === 1 ? '' : 's'}?`)) return
    const res = await fetch('/api/admin/onboarding/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({}),
    })
    if (!res.ok) {
      alert('Failed to acknowledge')
      return
    }
    mutate()
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Onboarding Progress</h1>
          <p className="text-muted-foreground text-sm">
            Track employee onboarding completion across businesses.
          </p>
        </div>
        {unackCount > 0 && (
          <button
            type="button"
            onClick={handleAckAll}
            className="bg-primary text-primary-foreground px-4 py-2 rounded-md font-medium hover:opacity-90 text-sm"
          >
            Acknowledge {unackCount} New
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
          className="bg-card border border-border rounded-md px-3 py-2 text-sm"
        >
          <option value="all">All Status</option>
          <option value="incomplete">In Progress / Not Started</option>
          <option value="completed">Completed</option>
          <option value="unack">Unacknowledged Completions</option>
        </select>

        <select
          value={bizFilter}
          onChange={(e) => setBizFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          className="bg-card border border-border rounded-md px-3 py-2 text-sm"
        >
          <option value="all">All Businesses</option>
          {businesses.map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
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
          No matching records.
        </div>
      )}

      {!isLoading && filtered.length > 0 && (
        <div className="bg-card border border-border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left p-3">Employee</th>
                <th className="text-left p-3 hidden sm:table-cell">Business</th>
                <th className="text-left p-3">Progress</th>
                <th className="text-left p-3 hidden md:table-cell">Status</th>
                <th className="text-right p-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const bizLabel = r.business_location
                  ? `${r.business_name} — ${r.business_location}`
                  : r.business_name
                return (
                  <tr key={`${r.employee_id}:${r.business_id}`} className="border-t border-border">
                    <td className="p-3">
                      <div className="font-medium">{r.employee_name}</div>
                      {r.employee_email && (
                        <div className="text-xs text-muted-foreground">{r.employee_email}</div>
                      )}
                      <div className="text-xs text-muted-foreground sm:hidden mt-0.5">{bizLabel}</div>
                    </td>
                    <td className="p-3 hidden sm:table-cell">{bizLabel}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 max-w-[120px] bg-muted rounded-full h-2">
                          <div className="bg-primary h-2 rounded-full" style={{ width: `${r.progress_pct}%` }} />
                        </div>
                        <span className="text-xs font-medium tabular-nums">{r.progress_pct}%</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {r.required_completed}/{r.required_total} required
                      </div>
                    </td>
                    <td className="p-3 hidden md:table-cell">
                      {r.is_completed ? (
                        <div>
                          <span className="text-xs bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 px-2 py-0.5 rounded">
                            ✅ Completed
                          </span>
                          {r.completed_at && (
                            <div className="text-xs text-muted-foreground mt-1">
                              {new Date(r.completed_at).toLocaleDateString('en-US', {
                                year: 'numeric', month: 'short', day: 'numeric',
                              })}
                            </div>
                          )}
                          {!r.acknowledged && (
                            <span className="text-xs bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300 px-2 py-0.5 rounded mt-1 inline-block">
                              New
                            </span>
                          )}
                        </div>
                      ) : r.progress_pct > 0 ? (
                        <span className="text-xs bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300 px-2 py-0.5 rounded">
                          ⏳ In Progress
                        </span>
                      ) : (
                        <span className="text-xs bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 px-2 py-0.5 rounded">
                          Not Started
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      {r.is_completed && !r.acknowledged && (
                        <button
                          type="button"
                          onClick={() => handleAck(r.employee_id, r.business_id)}
                          className="text-primary hover:underline text-xs sm:text-sm"
                        >
                          Acknowledge
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
