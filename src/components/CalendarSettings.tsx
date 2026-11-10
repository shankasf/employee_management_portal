'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { formatDateTime } from '@/lib/utils'

/**
 * Calendar integration settings, shared by the admin and employee Settings
 * pages. Handles the one-click OAuth connects, the Apple/other subscription
 * link, and what gets synced.
 */

interface ProviderState {
  available: boolean
}

interface ConnectionState {
  provider: 'google' | 'microsoft'
  email: string | null
  status: string
  calendarName: string
  lastSyncedAt: string | null
  lastError: string | null
  realtime: boolean
}

interface Prefs {
  sync_shifts: boolean
  sync_tasks: boolean
  sync_events: boolean
  sync_birthdays: boolean
  share_external_with_admin: boolean
  share_external_details: boolean
  reminder_minutes: number
}

interface StatusResponse {
  providers: { google: ProviderState; microsoft: ProviderState; ics: ProviderState }
  connections: ConnectionState[]
  prefs: Prefs
  feed: { exists: boolean; count: number }
  baseUrl: string
}

const SYNC_TOGGLES: { key: keyof Prefs; label: string; hint: string }[] = [
  { key: 'sync_shifts', label: 'Shifts', hint: 'Your scheduled shifts, with location' },
  { key: 'sync_tasks', label: 'Tasks', hint: 'Task deadlines assigned to you' },
  { key: 'sync_events', label: 'Company events', hint: 'Events you are staffed on' },
  { key: 'sync_birthdays', label: 'Team birthdays', hint: 'All-day entries for teammates' },
]

const REMINDER_CHOICES = [
  { value: 0, label: 'No reminder' },
  { value: 15, label: '15 minutes before' },
  { value: 30, label: '30 minutes before' },
  { value: 60, label: '1 hour before' },
  { value: 120, label: '2 hours before' },
  { value: 1440, label: '1 day before' },
]

export function CalendarSettings({ role }: { role: 'admin' | 'employee' }) {
  const searchParams = useSearchParams()
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [feedUrl, setFeedUrl] = useState<{ https: string; webcal: string } | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/calendar/status')
      if (!res.ok) throw new Error('Failed to load')
      setStatus(await res.json())
    } catch {
      setMessage({ kind: 'error', text: 'Could not load calendar settings.' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Surface the result of an OAuth round trip.
  useEffect(() => {
    const connected = searchParams.get('calendar_connected')
    const error = searchParams.get('calendar_error')
    if (connected) {
      setMessage({
        kind: 'ok',
        text: `${connected === 'google' ? 'Google Calendar' : 'Outlook Calendar'} connected. Your shifts are syncing now.`,
      })
    } else if (error) {
      setMessage({ kind: 'error', text: error })
    }
  }, [searchParams])

  const savePrefs = async (patch: Partial<Prefs>) => {
    if (!status) return
    // Optimistic — the toggles should feel instant.
    const previous = status.prefs
    setStatus({ ...status, prefs: { ...previous, ...patch } })
    setSaving(true)
    try {
      const res = await fetch('/api/calendar/prefs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) throw new Error('save failed')
      const json = await res.json()
      setStatus((s) => (s ? { ...s, prefs: json.prefs } : s))
    } catch {
      setStatus((s) => (s ? { ...s, prefs: previous } : s))
      setMessage({ kind: 'error', text: 'Could not save that setting.' })
    } finally {
      setSaving(false)
    }
  }

  const connect = (provider: 'google' | 'microsoft') => {
    const returnTo = `/${role}/settings`
    window.location.href = `/api/calendar/connect/${provider}?returnTo=${encodeURIComponent(returnTo)}`
  }

  const disconnect = async (provider: 'google' | 'microsoft') => {
    const label = provider === 'google' ? 'Google Calendar' : 'Outlook Calendar'
    if (!confirm(`Disconnect ${label}? The PlayFunia calendar we created in your account will be removed.`)) {
      return
    }
    try {
      const res = await fetch('/api/calendar/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      })
      if (!res.ok) throw new Error()
      setMessage({ kind: 'ok', text: `${label} disconnected.` })
      await load()
    } catch {
      setMessage({ kind: 'error', text: 'Could not disconnect.' })
    }
  }

  const syncNow = async () => {
    setSyncing(true)
    setMessage(null)
    try {
      const res = await fetch('/api/calendar/sync', { method: 'POST' })
      if (!res.ok) throw new Error()
      setMessage({ kind: 'ok', text: 'Sync complete.' })
      await load()
    } catch {
      setMessage({ kind: 'error', text: 'Sync failed. Try reconnecting the account.' })
    } finally {
      setSyncing(false)
    }
  }

  const createFeed = async () => {
    try {
      const res = await fetch('/api/calendar/feed-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'Calendar subscription' }),
      })
      if (!res.ok) throw new Error()
      const json = await res.json()
      setFeedUrl({ https: json.url, webcal: json.webcalUrl })
      setMessage({
        kind: 'ok',
        text: 'Subscription link created. Copy it now — it is only shown once.',
      })
      await load()
    } catch {
      setMessage({ kind: 'error', text: 'Could not create the subscription link.' })
    }
  }

  const copyFeed = async () => {
    if (!feedUrl) return
    try {
      await navigator.clipboard.writeText(feedUrl.https)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setMessage({ kind: 'error', text: 'Copy failed — select the link and copy manually.' })
    }
  }

  if (loading) {
    return <div className="p-6 text-sm text-gray-500">Loading calendar settings…</div>
  }

  if (!status) {
    return <div className="p-6 text-sm text-red-600">Calendar settings are unavailable.</div>
  }

  const byProvider = new Map(status.connections.map((c) => [c.provider, c]))
  const google = byProvider.get('google')
  const microsoft = byProvider.get('microsoft')

  return (
    <div className="space-y-6">
      {message && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            message.kind === 'ok'
              ? 'border-green-200 bg-green-50 text-green-800'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* ---------------- Connected accounts ---------------- */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="mb-1 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-gray-900">Connected calendars</h2>
          {status.connections.length > 0 && (
            <button
              onClick={syncNow}
              disabled={syncing}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
          )}
        </div>
        <p className="mb-4 text-sm text-gray-500">
          Connect an account and your PlayFunia shifts appear in a dedicated “PlayFunia” calendar
          there. Your personal events stay untouched.
        </p>

        <div className="space-y-3">
          <ProviderRow
            name="Google Calendar"
            icon="🗓️"
            description="One-click sign in with Google. Updates both ways, within seconds."
            available={status.providers.google.available}
            connection={google}
            onConnect={() => connect('google')}
            onDisconnect={() => disconnect('google')}
          />

          <ProviderRow
            name="Outlook / Microsoft 365"
            icon="📧"
            description="One-click sign in with Microsoft. Updates both ways, within seconds."
            available={status.providers.microsoft.available}
            connection={microsoft}
            onConnect={() => connect('microsoft')}
            onDisconnect={() => disconnect('microsoft')}
          />
        </div>
      </section>

      {/* ---------------- Apple / subscription link ---------------- */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-gray-900">Apple Calendar &amp; other apps</h2>
        <p className="mt-1 text-sm text-gray-500">
          Apple does not offer a one-click calendar sign-in, so instead you get a private
          subscription link. Open it on your iPhone or Mac and Calendar will keep your shifts up to
          date automatically. The same link works in Outlook, Google Calendar and most other apps.
        </p>
        <p className="mt-2 text-xs text-gray-400">
          Subscribed calendars refresh on your device’s own schedule — usually within a few hours,
          not instantly. Connect Google or Outlook above if you want immediate updates.
        </p>

        {feedUrl ? (
          <div className="mt-4 space-y-3">
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-medium text-amber-900">
                Copy this now — it will not be shown again. Treat it like a password: anyone with
                the link can see your schedule.
              </p>
              <code className="mt-2 block break-all rounded bg-white px-2 py-1.5 text-xs text-gray-700">
                {feedUrl.https}
              </code>
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                href={feedUrl.webcal}
                className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700"
              >
                Add to Apple Calendar
              </a>
              <button
                onClick={copyFeed}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              onClick={createFeed}
              className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700"
            >
              {status.feed.exists ? 'Generate a new link' : 'Create subscription link'}
            </button>
            {status.feed.exists && (
              <span className="text-xs text-gray-500">
                A link already exists. Generating a new one revokes the old one.
              </span>
            )}
          </div>
        )}

        <div className="mt-4">
          <a
            href="/api/calendar/download?type=all"
            className="text-sm font-medium text-purple-700 hover:underline"
          >
            Or download a one-time .ics file
          </a>
        </div>
      </section>

      {/* ---------------- What syncs ---------------- */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-gray-900">What gets synced</h2>
        <p className="mt-1 text-sm text-gray-500">
          Applies to every calendar you have connected, and to the subscription link.
        </p>

        <div className="mt-4 space-y-3">
          {SYNC_TOGGLES.map((t) => (
            <label key={t.key} className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={Boolean(status.prefs[t.key])}
                onChange={(e) => savePrefs({ [t.key]: e.target.checked } as Partial<Prefs>)}
                disabled={saving}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-purple-600"
              />
              <span>
                <span className="block text-sm font-medium text-gray-900">{t.label}</span>
                <span className="block text-xs text-gray-500">{t.hint}</span>
              </span>
            </label>
          ))}
        </div>

        <div className="mt-5">
          <label className="block text-sm font-medium text-gray-900">Reminder</label>
          <select
            value={status.prefs.reminder_minutes}
            onChange={(e) => savePrefs({ reminder_minutes: Number(e.target.value) })}
            disabled={saving}
            className="mt-1 w-full max-w-xs rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            {REMINDER_CHOICES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* ---------------- Privacy ---------------- */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-gray-900">Sharing with your manager</h2>
        <p className="mt-1 text-sm text-gray-500">
          Your shifts are always visible to your manager. These settings only control your
          <strong> personal </strong> calendar events.
        </p>

        <div className="mt-4 space-y-3">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={status.prefs.share_external_with_admin}
              onChange={(e) => savePrefs({ share_external_with_admin: e.target.checked })}
              disabled={saving}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-purple-600"
            />
            <span>
              <span className="block text-sm font-medium text-gray-900">
                Show when I am busy
              </span>
              <span className="block text-xs text-gray-500">
                Managers see anonymous “Busy” blocks from your personal calendar so they avoid
                scheduling you over something. No titles or details.
              </span>
            </span>
          </label>

          <label className={`flex items-start gap-3 ${!status.prefs.share_external_with_admin ? 'opacity-50' : ''}`}>
            <input
              type="checkbox"
              checked={status.prefs.share_external_details}
              onChange={(e) => savePrefs({ share_external_details: e.target.checked })}
              disabled={saving || !status.prefs.share_external_with_admin}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-purple-600"
            />
            <span>
              <span className="block text-sm font-medium text-gray-900">
                Also show event titles and details
              </span>
              <span className="block text-xs text-gray-500">
                Managers see what your personal events actually are. Most people leave this off.
              </span>
            </span>
          </label>
        </div>
      </section>
    </div>
  )
}

function ProviderRow({
  name,
  icon,
  description,
  available,
  connection,
  onConnect,
  onDisconnect,
}: {
  name: string
  icon: string
  description: string
  available: boolean
  connection?: ConnectionState
  onConnect: () => void
  onDisconnect: () => void
}) {
  const needsReauth = connection?.status === 'needs_reauth'

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 p-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span aria-hidden>{icon}</span>
          <span className="font-medium text-gray-900">{name}</span>
          {connection && !needsReauth && (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
              Connected
            </span>
          )}
          {needsReauth && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
              Reconnect needed
            </span>
          )}
        </div>

        {connection ? (
          <div className="mt-1 space-y-0.5 text-xs text-gray-500">
            {connection.email && <div className="break-all">{connection.email}</div>}
            <div>
              {connection.lastSyncedAt
                ? `Last synced ${formatDateTime(connection.lastSyncedAt)}`
                : 'Not synced yet'}
              {connection.realtime ? ' · live updates on' : ''}
            </div>
            {needsReauth && (
              <div className="text-amber-700">
                Access expired or was revoked — reconnect to resume syncing.
              </div>
            )}
          </div>
        ) : (
          <p className="mt-1 text-xs text-gray-500">{description}</p>
        )}
      </div>

      <div className="flex shrink-0 gap-2">
        {connection ? (
          <>
            {needsReauth && (
              <button
                onClick={onConnect}
                className="rounded-lg bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-700"
              >
                Reconnect
              </button>
            )}
            <button
              onClick={onDisconnect}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Disconnect
            </button>
          </>
        ) : available ? (
          <button
            onClick={onConnect}
            className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700"
          >
            Connect
          </button>
        ) : (
          <span className="text-xs text-gray-400">Not configured yet</span>
        )}
      </div>
    </div>
  )
}
