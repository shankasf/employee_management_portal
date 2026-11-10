import { contentHash, decryptToken, encryptToken, generateSecret } from './crypto'
import { collectItems, defaultSyncWindow, getScheduleItems, type SyncWindow } from './sources'
import {
  DEFAULT_SYNC_PREFS,
  type CalendarConnectionRow,
  type CalendarProvider,
  type CalendarSourceType,
  type CalendarSyncPrefs,
  type ExternalEvent,
  type PlayfuniaItem,
} from './types'
import * as google from './providers/google'
import * as microsoft from './providers/microsoft'
import { ReauthRequiredError, SyncTokenExpiredError } from './providers/google'
import { calendarDb } from './db'
import { calLog, startTimer } from './log'

/**
 * Provider-agnostic sync engine.
 *
 * Outbound (push): reconcile the user's PlayFunia items against the events we
 * previously created in their dedicated calendar — insert new, update changed,
 * delete removed/cancelled. A content hash keeps unchanged items off the wire.
 *
 * Inbound (pull): cache their external events for the in-app views, and turn
 * employee edits to *our* events into change requests for an admin rather than
 * letting them silently rewrite a shift.
 */

// ---------------------------------------------------------------------------
// Connection + preference helpers
// ---------------------------------------------------------------------------

export async function getPrefs(userId: string): Promise<CalendarSyncPrefs> {
  const service = await calendarDb()
  const { data } = await service
    .from('calendar_sync_prefs')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()

  if (data) return data as CalendarSyncPrefs
  return { user_id: userId, ...DEFAULT_SYNC_PREFS }
}

export async function getConnections(userId: string): Promise<CalendarConnectionRow[]> {
  const service = await calendarDb()
  const { data } = await service
    .from('calendar_connections')
    .select('*')
    .eq('user_id', userId)
  return (data || []) as CalendarConnectionRow[]
}

export async function getConnection(
  userId: string,
  provider: CalendarProvider,
): Promise<CalendarConnectionRow | null> {
  const service = await calendarDb()
  const { data } = await service
    .from('calendar_connections')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', provider)
    .maybeSingle()
  return (data as CalendarConnectionRow) || null
}

async function markConnection(
  connectionId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const service = await calendarDb()
  await service.from('calendar_connections').update(patch).eq('id', connectionId)
}

/**
 * Return a usable access token, refreshing (and persisting) when it is within
 * two minutes of expiry. Throws ReauthRequiredError when we cannot recover.
 */
export async function getAccessToken(conn: CalendarConnectionRow): Promise<string> {
  const current = decryptToken(conn.access_token_enc)
  const expiresAt = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0
  const stillValid = current && expiresAt > Date.now() + 120_000
  if (stillValid) return current as string

  const refreshToken = decryptToken(conn.refresh_token_enc)
  if (!refreshToken) {
    calLog.error('token', 'No usable refresh token — marking connection for re-auth', {
      userId: conn.user_id, connectionId: conn.id, provider: conn.provider,
      hadEncrypted: Boolean(conn.refresh_token_enc),
    })
    await markConnection(conn.id, { status: 'needs_reauth', last_error: 'No refresh token stored' })
    throw new ReauthRequiredError()
  }

  calLog.debug('token', 'Access token expired or missing, refreshing', {
    userId: conn.user_id, connectionId: conn.id, provider: conn.provider,
    expiredAt: conn.token_expires_at,
  })

  try {
    const refreshed =
      conn.provider === 'google'
        ? await google.refreshGoogleToken(refreshToken)
        : await microsoft.refreshMicrosoftToken(refreshToken)

    await markConnection(conn.id, {
      access_token_enc: encryptToken(refreshed.accessToken),
      // Microsoft rotates refresh tokens; Google usually does not return one.
      ...(refreshed.refreshToken
        ? { refresh_token_enc: encryptToken(refreshed.refreshToken) }
        : {}),
      token_expires_at: refreshed.expiresAt,
      status: 'active',
      last_error: null,
    })
    calLog.info('token', 'Access token refreshed', {
      userId: conn.user_id, connectionId: conn.id, provider: conn.provider,
      rotatedRefreshToken: Boolean(refreshed.refreshToken),
      expiresAt: refreshed.expiresAt,
    })
    return refreshed.accessToken
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Token refresh failed'
    calLog.error('token', 'Token refresh failed — connection needs re-auth', {
      userId: conn.user_id, connectionId: conn.id, provider: conn.provider, error: err,
    })
    await markConnection(conn.id, { status: 'needs_reauth', last_error: message })
    throw new ReauthRequiredError(message)
  }
}

// ---------------------------------------------------------------------------
// Outbound push
// ---------------------------------------------------------------------------

interface LinkRow {
  id: string
  source_type: CalendarSourceType
  source_id: string
  external_event_id: string
  content_hash: string | null
}

/** An item should exist in the calendar unless it was cancelled or deleted. */
function shouldExist(item: PlayfuniaItem): boolean {
  if (item.status === 'cancelled') return false
  // A completed task has already happened; keep it, it is useful history.
  return true
}

export interface PushResult {
  inserted: number
  updated: number
  deleted: number
  skipped: number
  errors: string[]
}

export async function pushToProvider(
  conn: CalendarConnectionRow,
  prefs: CalendarSyncPrefs,
  window: SyncWindow = defaultSyncWindow(),
): Promise<PushResult> {
  const result: PushResult = { inserted: 0, updated: 0, deleted: 0, skipped: 0, errors: [] }

  const elapsed = startTimer()

  if (!conn.target_calendar_id) {
    calLog.error('push', 'Connection has no target calendar — cannot push', {
      userId: conn.user_id, connectionId: conn.id, provider: conn.provider,
    })
    result.errors.push('No target calendar on this connection')
    return result
  }

  const service = await calendarDb()
  const accessToken = await getAccessToken(conn)
  const calendarId = conn.target_calendar_id

  const items = await collectItems(conn.user_id, prefs, window)

  calLog.debug('push', 'Collected PlayFunia items for push', {
    userId: conn.user_id, connectionId: conn.id, provider: conn.provider,
    items: items.length, window: `${window.startDate}..${window.endDate}`,
    prefs: {
      shifts: prefs.sync_shifts, tasks: prefs.sync_tasks,
      events: prefs.sync_events, birthdays: prefs.sync_birthdays,
    },
  })

  const { data: linkRows } = await service
    .from('calendar_event_links')
    .select('id, source_type, source_id, external_event_id, content_hash')
    .eq('connection_id', conn.id)

  const links = new Map<string, LinkRow>()
  for (const row of (linkRows || []) as LinkRow[]) {
    links.set(`${row.source_type}:${row.source_id}`, row)
  }

  const seen = new Set<string>()

  const insertEvent = conn.provider === 'google' ? google.insertGoogleEvent : microsoft.insertMicrosoftEvent
  const updateEvent = conn.provider === 'google' ? google.updateGoogleEvent : microsoft.updateMicrosoftEvent
  const removeEvent = conn.provider === 'google' ? google.deleteGoogleEvent : microsoft.deleteMicrosoftEvent

  for (const item of items) {
    const key = `${item.sourceType}:${item.sourceId}`
    seen.add(key)
    const existing = links.get(key)
    const hash = contentHash({
      t: item.title,
      d: item.description,
      l: item.location,
      s: item.start ?? item.startDate,
      e: item.end ?? item.endDate,
      a: item.allDay,
      st: item.status,
      r: prefs.reminder_minutes,
    })

    try {
      if (!shouldExist(item)) {
        if (existing) {
          await removeEvent(accessToken, calendarId, existing.external_event_id)
          await service.from('calendar_event_links').delete().eq('id', existing.id)
          result.deleted++
        }
        continue
      }

      if (!existing) {
        const eventId = await insertEvent(accessToken, calendarId, item, prefs.reminder_minutes)
        await service.from('calendar_event_links').insert({
          connection_id: conn.id,
          user_id: conn.user_id,
          source_type: item.sourceType,
          source_id: item.sourceId,
          external_event_id: eventId,
          content_hash: hash,
        })
        result.inserted++
        continue
      }

      if (existing.content_hash === hash) {
        result.skipped++
        continue
      }

      await updateEvent(accessToken, calendarId, existing.external_event_id, item, prefs.reminder_minutes)
      await service
        .from('calendar_event_links')
        .update({ content_hash: hash })
        .eq('id', existing.id)
      result.updated++
    } catch (err) {
      if (err instanceof ReauthRequiredError) throw err
      calLog.error('push', 'Failed to push one item', {
        userId: conn.user_id, connectionId: conn.id, provider: conn.provider,
        item: key, externalEventId: existing?.external_event_id, error: err,
      })
      result.errors.push(`${key}: ${err instanceof Error ? err.message : 'push failed'}`)
    }
  }

  // Anything linked but no longer produced by the sources (deleted upstream, or
  // a preference was switched off) is removed from their calendar.
  for (const [key, link] of Array.from(links.entries())) {
    if (seen.has(key)) continue
    try {
      await removeEvent(accessToken, calendarId, link.external_event_id)
      await service.from('calendar_event_links').delete().eq('id', link.id)
      result.deleted++
    } catch (err) {
      if (err instanceof ReauthRequiredError) throw err
      calLog.error('push', 'Failed to remove an orphaned event', {
        userId: conn.user_id, connectionId: conn.id, provider: conn.provider,
        item: key, externalEventId: link.external_event_id, error: err,
      })
      result.errors.push(`${key}: ${err instanceof Error ? err.message : 'delete failed'}`)
    }
  }

  calLog.info('push', 'Push complete', {
    userId: conn.user_id, connectionId: conn.id, provider: conn.provider,
    duration: elapsed(),
    inserted: result.inserted, updated: result.updated,
    deleted: result.deleted, skipped: result.skipped, errors: result.errors.length,
  })

  return result
}

// ---------------------------------------------------------------------------
// Inbound pull
// ---------------------------------------------------------------------------

/** Sync tokens are stored per-calendar as a JSON map in one column. */
function parseSyncTokens(raw: string | null): Record<string, string> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

async function cacheExternalEvents(
  conn: CalendarConnectionRow,
  events: ExternalEvent[],
  deletedIds: string[],
): Promise<void> {
  const service = await calendarDb()

  if (events.length) {
    const rows = events.map((ev) => ({
      connection_id: conn.id,
      user_id: conn.user_id,
      provider: conn.provider,
      external_id: ev.externalId,
      calendar_id: ev.calendarId,
      title: ev.title,
      description: ev.description,
      location: ev.location,
      starts_at: ev.startsAt,
      ends_at: ev.endsAt,
      all_day: ev.allDay,
      transparency: ev.transparency,
      status: ev.status,
      organizer_email: ev.organizerEmail,
      html_link: ev.htmlLink,
      is_playfunia: ev.isPlayfunia,
      updated_at: new Date().toISOString(),
    }))

    // Chunked so a heavy calendar does not build one enormous statement.
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await service
        .from('calendar_external_events')
        .upsert(rows.slice(i, i + 200), { onConflict: 'connection_id,external_id' })
      if (error) {
        calLog.error('pull', 'Failed to cache external events batch', {
          userId: conn.user_id, connectionId: conn.id, provider: conn.provider,
          batchSize: Math.min(200, rows.length - i), error,
        })
        throw new Error(`Failed to cache external events: ${error.message}`)
      }
    }
  }

  if (deletedIds.length) {
    for (let i = 0; i < deletedIds.length; i += 200) {
      await service
        .from('calendar_external_events')
        .delete()
        .eq('connection_id', conn.id)
        .in('external_id', deletedIds.slice(i, i + 200))
    }
  }
}

/**
 * Detect employee edits to events WE created and file them as change requests.
 *
 * Rule (chosen deliberately): PlayFunia stays the source of truth. Deleting a
 * synced shift in Google/Outlook files a cancellation request through the same
 * flow as the in-app button; moving it files a reschedule request. Neither
 * silently rewrites the schedule.
 */
async function handleInboundEdits(
  conn: CalendarConnectionRow,
  events: ExternalEvent[],
  deletedIds: string[],
): Promise<{ cancelRequests: number; rescheduleRequests: number }> {
  const service = await calendarDb()
  let cancelRequests = 0
  let rescheduleRequests = 0

  const { data: linkRows } = await service
    .from('calendar_event_links')
    .select('id, source_type, source_id, external_event_id')
    .eq('connection_id', conn.id)

  const byExternalId = new Map<string, LinkRow>()
  for (const row of (linkRows || []) as LinkRow[]) {
    byExternalId.set(row.external_event_id, row)
  }

  // --- deletions -> cancellation requests ---
  for (const externalId of deletedIds) {
    const link = byExternalId.get(externalId)
    if (!link) continue

    calLog.info('edits', 'Synced event was deleted in the external calendar', {
      userId: conn.user_id, connectionId: conn.id, provider: conn.provider,
      sourceType: link.source_type, sourceId: link.source_id, externalEventId: externalId,
    })

    if (link.source_type === 'schedule') {
      const filed = await fileCancellationRequest(conn, link.source_id, 'Removed from their connected calendar')
      if (filed) cancelRequests++
    } else {
      await recordChangeRequest(conn, link.source_type, link.source_id, 'cancel', null, null,
        'Removed from their connected calendar')
      cancelRequests++
    }
  }

  // --- moves -> reschedule requests ---
  for (const ev of events) {
    const link = byExternalId.get(ev.externalId)
    // Only shifts are approval-gated; a moved task or event is not worth a request.
    if (!link || !ev.startsAt || link.source_type !== 'schedule') continue

    // Compare against what we last pushed by re-deriving the expected instant.
    // A missing schedule (deleted upstream) yields null and is skipped.
    const expectedStart = await expectedStartFor(link.source_id)
    if (!expectedStart) continue

    const drift = Math.abs(new Date(ev.startsAt).getTime() - new Date(expectedStart).getTime())
    if (drift < 60_000) continue // within a minute — no real change

    calLog.info('edits', 'Synced shift was moved in the external calendar', {
      userId: conn.user_id, connectionId: conn.id, provider: conn.provider,
      scheduleId: link.source_id, expectedStart, observedStart: ev.startsAt,
      driftMinutes: Math.round(drift / 60000),
    })

    const filed = await recordChangeRequest(
      conn,
      'schedule',
      link.source_id,
      'reschedule',
      ev.startsAt,
      ev.endsAt,
      'Moved in their connected calendar',
    )
    if (filed) rescheduleRequests++
  }

  if (cancelRequests || rescheduleRequests) {
    calLog.info('edits', 'Filed change requests from external calendar edits', {
      userId: conn.user_id, connectionId: conn.id, provider: conn.provider,
      cancelRequests, rescheduleRequests,
    })
  }

  return { cancelRequests, rescheduleRequests }
}

/** The UTC instant a schedule should start at, per PlayFunia. */
async function expectedStartFor(scheduleId: string): Promise<string | null> {
  const service = await calendarDb()
  const { data } = await service
    .from('schedules')
    .select('employee_id, schedule_date')
    .eq('id', scheduleId)
    .maybeSingle()
  if (!data) return null

  const row = data as { employee_id: string; schedule_date: string }
  const items = await getScheduleItems(row.employee_id, {
    startDate: row.schedule_date,
    endDate: row.schedule_date,
  })
  return items.find((i) => i.sourceId === scheduleId)?.start ?? null
}

/** Route a shift cancellation through the existing approval RPC. */
async function fileCancellationRequest(
  conn: CalendarConnectionRow,
  scheduleId: string,
  reason: string,
): Promise<boolean> {
  const service = await calendarDb()

  const { data: sched } = await service
    .from('schedules')
    .select('id, status, cancellation_requested_at')
    .eq('id', scheduleId)
    .maybeSingle()

  const row = sched as { status: string; cancellation_requested_at: string | null } | null
  if (!row) {
    calLog.warn('edits', 'Cancellation requested for a schedule that no longer exists', {
      userId: conn.user_id, connectionId: conn.id, scheduleId,
    })
    return false
  }
  // Already cancelled or already requested — do not stack duplicates.
  if (row.status === 'cancelled' || row.cancellation_requested_at) {
    calLog.debug('edits', 'Skipping duplicate cancellation request', {
      userId: conn.user_id, scheduleId, status: row.status,
    })
    return false
  }

  const { error } = await service
    .from('schedules')
    .update({
      status: 'cancellation_requested',
      cancellation_requested_at: new Date().toISOString(),
      cancellation_reason: reason,
    })
    .eq('id', scheduleId)

  if (error) {
    calLog.error('edits', 'Could not set schedule to cancellation_requested', {
      userId: conn.user_id, connectionId: conn.id, scheduleId, error,
    })
    return false
  }

  calLog.info('edits', 'Schedule moved to cancellation_requested from calendar deletion', {
    userId: conn.user_id, connectionId: conn.id, scheduleId, reason,
  })
  await recordChangeRequest(conn, 'schedule', scheduleId, 'cancel', null, null, reason)
  return true
}

/** Log the request for the admin Employee Calendar page. Deduped while pending. */
async function recordChangeRequest(
  conn: CalendarConnectionRow,
  sourceType: CalendarSourceType,
  sourceId: string,
  kind: 'cancel' | 'reschedule',
  requestedStart: string | null,
  requestedEnd: string | null,
  note: string,
): Promise<boolean> {
  const service = await calendarDb()

  const { data: existing } = await service
    .from('calendar_change_requests')
    .select('id')
    .eq('source_type', sourceType)
    .eq('source_id', sourceId)
    .eq('kind', kind)
    .eq('status', 'pending')
    .maybeSingle()

  if (existing) return false

  const { error } = await service.from('calendar_change_requests').insert({
    user_id: conn.user_id,
    connection_id: conn.id,
    source_type: sourceType,
    source_id: sourceId,
    kind,
    requested_start: requestedStart,
    requested_end: requestedEnd,
    note,
  })

  if (error) {
    calLog.error('edits', 'Could not record change request', {
      userId: conn.user_id, connectionId: conn.id, sourceType, sourceId, kind, error,
    })
  }

  return !error
}

export interface PullResult {
  cached: number
  removed: number
  cancelRequests: number
  rescheduleRequests: number
  errors: string[]
}

export async function pullFromProvider(
  conn: CalendarConnectionRow,
  window: SyncWindow = defaultSyncWindow(),
): Promise<PullResult> {
  const result: PullResult = {
    cached: 0,
    removed: 0,
    cancelRequests: 0,
    rescheduleRequests: 0,
    errors: [],
  }

  const elapsed = startTimer()
  const accessToken = await getAccessToken(conn)
  const tokens = parseSyncTokens(conn.sync_token)
  const nextTokens: Record<string, string> = { ...tokens }

  const timeMin = new Date(`${window.startDate}T00:00:00Z`).toISOString()
  const timeMax = new Date(`${window.endDate}T23:59:59Z`).toISOString()

  // Read our own calendar (to catch employee edits) and their default calendar
  // (to power the unified view and the admin conflict check).
  const calendars: { id: string; isOurs: boolean }[] = []
  if (conn.target_calendar_id) calendars.push({ id: conn.target_calendar_id, isOurs: true })
  calendars.push({ id: conn.provider === 'google' ? 'primary' : 'default', isOurs: false })

  for (const cal of calendars) {
    try {
      let events: ExternalEvent[] = []
      let deletedIds: string[] = []
      let nextToken: string | null = null

      if (conn.provider === 'google') {
        try {
          const res = await google.listGoogleChanges(accessToken, cal.id, tokens[cal.id] || null, {
            timeMin,
            timeMax,
          })
          events = res.events
          deletedIds = res.deletedIds
          nextToken = res.nextSyncToken
        } catch (err) {
          if (!(err instanceof SyncTokenExpiredError)) throw err
          // Token aged out — Google requires a clean full sync.
          calLog.warn('pull', 'Google syncToken expired, falling back to full resync', {
            userId: conn.user_id, connectionId: conn.id, calendarId: cal.id,
          })
          const res = await google.listGoogleChanges(accessToken, cal.id, null, { timeMin, timeMax })
          events = res.events
          deletedIds = res.deletedIds
          nextToken = res.nextSyncToken
        }
      } else {
        try {
          const res = await microsoft.listMicrosoftChanges(
            accessToken,
            cal.id,
            tokens[cal.id] || null,
            { timeMin, timeMax },
            cal.isOurs,
          )
          events = res.events
          deletedIds = res.deletedIds
          nextToken = res.nextSyncToken
        } catch (err) {
          if (!(err instanceof SyncTokenExpiredError)) throw err
          calLog.warn('pull', 'Microsoft deltaLink expired, falling back to full resync', {
            userId: conn.user_id, connectionId: conn.id, calendarId: cal.id,
          })
          const res = await microsoft.listMicrosoftChanges(accessToken, cal.id, null, { timeMin, timeMax }, cal.isOurs)
          events = res.events
          deletedIds = res.deletedIds
          nextToken = res.nextSyncToken
        }
      }

      // Mark events living in our calendar as ours even if the tag is missing.
      if (cal.isOurs) events = events.map((e) => ({ ...e, isPlayfunia: true }))

      await cacheExternalEvents(conn, events, deletedIds)
      result.cached += events.length
      result.removed += deletedIds.length

      if (cal.isOurs) {
        const edits = await handleInboundEdits(conn, events, deletedIds)
        result.cancelRequests += edits.cancelRequests
        result.rescheduleRequests += edits.rescheduleRequests
      }

      calLog.debug('pull', 'Pulled one calendar', {
        userId: conn.user_id, connectionId: conn.id, provider: conn.provider,
        calendarId: cal.id, isOurs: cal.isOurs,
        events: events.length, deleted: deletedIds.length,
        incremental: Boolean(tokens[cal.id]), gotNextToken: Boolean(nextToken),
      })

      if (nextToken) nextTokens[cal.id] = nextToken
    } catch (err) {
      if (err instanceof ReauthRequiredError) throw err
      calLog.error('pull', 'Failed to pull a calendar', {
        userId: conn.user_id, connectionId: conn.id, provider: conn.provider,
        calendarId: cal.id, isOurs: cal.isOurs, error: err,
      })
      result.errors.push(`${cal.id}: ${err instanceof Error ? err.message : 'pull failed'}`)
    }
  }

  await markConnection(conn.id, { sync_token: JSON.stringify(nextTokens) })

  calLog.info('pull', 'Pull complete', {
    userId: conn.user_id, connectionId: conn.id, provider: conn.provider,
    duration: elapsed(),
    cached: result.cached, removed: result.removed,
    cancelRequests: result.cancelRequests, rescheduleRequests: result.rescheduleRequests,
    errors: result.errors.length,
  })

  return result
}

// ---------------------------------------------------------------------------
// Whole-connection sync + watch lifecycle
// ---------------------------------------------------------------------------

export interface SyncResult {
  provider: CalendarProvider
  push: PushResult | null
  pull: PullResult | null
  status: string
  error?: string
}

export async function syncConnection(
  conn: CalendarConnectionRow,
  prefs?: CalendarSyncPrefs,
): Promise<SyncResult> {
  const resolvedPrefs = prefs || (await getPrefs(conn.user_id))
  const elapsed = startTimer()

  calLog.info('push', 'Sync started', {
    userId: conn.user_id, connectionId: conn.id, provider: conn.provider,
    lastSyncedAt: conn.last_synced_at, status: conn.status,
  })

  try {
    const push = await pushToProvider(conn, resolvedPrefs)
    // Re-read: push may have refreshed the token and rotated sync state.
    const fresh = (await getConnection(conn.user_id, conn.provider)) || conn
    const pull = await pullFromProvider(fresh)

    await markConnection(conn.id, {
      last_synced_at: new Date().toISOString(),
      status: 'active',
      last_error: push.errors.length || pull.errors.length
        ? [...push.errors, ...pull.errors].slice(0, 3).join('; ').slice(0, 500)
        : null,
    })

    calLog.info('push', 'Sync finished', {
      userId: conn.user_id, connectionId: conn.id, provider: conn.provider,
      duration: elapsed(),
      pushed: `${push.inserted}i/${push.updated}u/${push.deleted}d/${push.skipped}s`,
      pulled: pull.cached, pullRemoved: pull.removed,
      errors: push.errors.length + pull.errors.length,
    })

    return { provider: conn.provider, push, pull, status: 'ok' }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sync failed'
    const status = err instanceof ReauthRequiredError ? 'needs_reauth' : 'error'
    calLog.error('push', `Sync aborted (${status})`, {
      userId: conn.user_id, connectionId: conn.id, provider: conn.provider,
      duration: elapsed(), error: err,
    })
    await markConnection(conn.id, { status, last_error: message.slice(0, 500) })
    return { provider: conn.provider, push: null, pull: null, status, error: message }
  }
}

export async function syncUser(userId: string): Promise<SyncResult[]> {
  const conns = (await getConnections(userId)).filter((c) => c.status !== 'revoked')
  if (!conns.length) {
    calLog.debug('push', 'syncUser called but no active connections', { userId })
    return []
  }
  const prefs = await getPrefs(userId)
  const results: SyncResult[] = []
  for (const conn of conns) {
    results.push(await syncConnection(conn, prefs))
  }
  return results
}

/** Open or renew the provider's push channel so changes reach us quickly. */
export async function ensureWatch(conn: CalendarConnectionRow): Promise<void> {
  if (!conn.target_calendar_id) return

  const expires = conn.watch_expires_at ? new Date(conn.watch_expires_at).getTime() : 0
  // Renew a day before expiry so a missed cron run does not drop notifications.
  if (expires > Date.now() + 24 * 3600 * 1000) {
    calLog.debug('watch', 'Push channel still healthy, no renewal needed', {
      userId: conn.user_id, connectionId: conn.id, provider: conn.provider,
      expiresAt: conn.watch_expires_at,
    })
    return
  }

  calLog.info('watch', 'Opening or renewing push channel', {
    userId: conn.user_id, connectionId: conn.id, provider: conn.provider,
    previousExpiry: conn.watch_expires_at,
  })

  const accessToken = await getAccessToken(conn)
  const secret = conn.watch_secret || generateSecret(24)

  if (conn.provider === 'google') {
    if (conn.watch_channel_id && conn.watch_resource_id) {
      await google.stopGoogleWatch(accessToken, conn.watch_channel_id, conn.watch_resource_id)
    }
    const channelId = generateSecret(16)
    const { resourceId, expiration } = await google.watchGoogleCalendar(
      accessToken,
      conn.target_calendar_id,
      channelId,
      secret,
    )
    await markConnection(conn.id, {
      watch_channel_id: channelId,
      watch_resource_id: resourceId,
      watch_secret: secret,
      watch_expires_at: expiration,
    })
    calLog.info('watch', 'Google push channel opened', {
      userId: conn.user_id, connectionId: conn.id, channelId, expiresAt: expiration,
    })
  } else {
    if (conn.watch_channel_id) {
      try {
        const expiration = await microsoft.renewMicrosoftSubscription(accessToken, conn.watch_channel_id)
        await markConnection(conn.id, { watch_expires_at: expiration })
        calLog.info('watch', 'Microsoft subscription renewed', {
          userId: conn.user_id, connectionId: conn.id,
          subscriptionId: conn.watch_channel_id, expiresAt: expiration,
        })
        return
      } catch (err) {
        // Subscription is gone — fall through and create a new one.
        calLog.warn('watch', 'Microsoft subscription renewal failed, creating a new one', {
          userId: conn.user_id, connectionId: conn.id,
          subscriptionId: conn.watch_channel_id, error: err,
        })
      }
    }
    const { subscriptionId, expiration } = await microsoft.subscribeMicrosoftCalendar(
      accessToken,
      conn.target_calendar_id,
      secret,
    )
    await markConnection(conn.id, {
      watch_channel_id: subscriptionId,
      watch_resource_id: null,
      watch_secret: secret,
      watch_expires_at: expiration,
    })
    calLog.info('watch', 'Microsoft subscription created', {
      userId: conn.user_id, connectionId: conn.id, subscriptionId, expiresAt: expiration,
    })
  }
}

/**
 * Disconnect: stop the watch, remove the calendar we created, revoke the grant
 * and delete every local trace of the connection.
 */
export async function disconnectProvider(
  userId: string,
  provider: CalendarProvider,
  removeRemoteCalendar = true,
): Promise<void> {
  const conn = await getConnection(userId, provider)
  if (!conn) {
    calLog.warn('oauth', 'Disconnect requested for a provider with no connection', {
      userId, provider,
    })
    return
  }

  calLog.info('oauth', 'Disconnecting provider', {
    userId, connectionId: conn.id, provider,
    removeRemoteCalendar, targetCalendarId: conn.target_calendar_id,
  })

  const service = await calendarDb()

  try {
    const accessToken = await getAccessToken(conn)

    if (provider === 'google') {
      if (conn.watch_channel_id && conn.watch_resource_id) {
        await google.stopGoogleWatch(accessToken, conn.watch_channel_id, conn.watch_resource_id)
      }
      if (removeRemoteCalendar && conn.target_calendar_id) {
        await google.deleteGoogleCalendar(accessToken, conn.target_calendar_id)
      }
      const refresh = decryptToken(conn.refresh_token_enc)
      if (refresh) await google.revokeGoogleToken(refresh)
    } else {
      if (conn.watch_channel_id) {
        await microsoft.deleteMicrosoftSubscription(accessToken, conn.watch_channel_id)
      }
      if (removeRemoteCalendar && conn.target_calendar_id) {
        await microsoft.deleteMicrosoftCalendar(accessToken, conn.target_calendar_id)
      }
    }
  } catch (err) {
    // The grant may already be revoked on their side; still clear our records.
    calLog.warn('oauth', 'Remote cleanup during disconnect failed — clearing local records anyway', {
      userId, connectionId: conn.id, provider, error: err,
    })
  }

  // Cascades remove event links and cached external events.
  const { error: deleteError } = await service
    .from('calendar_connections')
    .delete()
    .eq('id', conn.id)

  if (deleteError) {
    calLog.error('oauth', 'Failed to delete connection row', {
      userId, connectionId: conn.id, provider, error: deleteError,
    })
  } else {
    calLog.info('oauth', 'Provider disconnected and local records removed', {
      userId, connectionId: conn.id, provider,
    })
  }
}
