import { playfuniaTag, type ExternalEvent, type PlayfuniaItem } from '../types'
import { calLog } from '../log'

/**
 * Google Calendar integration over the REST API (no SDK dependency).
 *
 * Model:
 *  - We create a dedicated secondary calendar named "PlayFunia" in the user's
 *    account and write shifts/tasks/events there. Their personal calendar is
 *    never written to, and disconnecting can remove ours cleanly.
 *  - We read BOTH that calendar and their primary calendar, so "My Calendar"
 *    can show work and personal side by side and admins can spot conflicts.
 *  - Reads use syncTokens for incremental sync, with a 410 → full-resync
 *    fallback, which is what Google requires.
 */

const OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const OAUTH_REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3'
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  // Manage calendars: needed to create our secondary calendar and to read the
  // user's primary calendar for the unified view.
  'https://www.googleapis.com/auth/calendar',
].join(' ')

export function googleConfigured(): boolean {
  return Boolean(
    (process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID) &&
      (process.env.GOOGLE_CALENDAR_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET),
  )
}

function clientId(): string {
  const id = process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
  if (!id) throw new Error('Google client id is not configured')
  return id
}

function clientSecret(): string {
  const secret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET
  if (!secret) throw new Error('Google client secret is not configured')
  return secret
}

export function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://admin.playfunia.com').replace(/\/$/, '')
}

export function googleRedirectUri(): string {
  return `${appBaseUrl()}/api/calendar/callback/google`
}

/** Consent URL. `prompt=consent` + `access_type=offline` guarantees a refresh token. */
export function buildGoogleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: googleRedirectUri(),
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })
  return `${OAUTH_AUTH_URL}?${params.toString()}`
}

export interface TokenResponse {
  accessToken: string
  refreshToken: string | null
  expiresAt: string
  scope: string | null
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  })

  const json = (await res.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    scope?: string
    error?: string
    error_description?: string
  }

  if (!res.ok || !json.access_token) {
    throw new Error(`Google token request failed: ${json.error || res.status}`)
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token || null,
    expiresAt: new Date(Date.now() + (json.expires_in ?? 3600) * 1000).toISOString(),
    scope: json.scope || null,
  }
}

export function exchangeGoogleCode(code: string): Promise<TokenResponse> {
  return tokenRequest({
    code,
    client_id: clientId(),
    client_secret: clientSecret(),
    redirect_uri: googleRedirectUri(),
    grant_type: 'authorization_code',
  })
}

export function refreshGoogleToken(refreshToken: string): Promise<TokenResponse> {
  return tokenRequest({
    refresh_token: refreshToken,
    client_id: clientId(),
    client_secret: clientSecret(),
    grant_type: 'refresh_token',
  })
}

export async function revokeGoogleToken(token: string): Promise<void> {
  try {
    await fetch(OAUTH_REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
    })
  } catch {
    // Revocation is best-effort; we still drop our copy of the tokens.
  }
}

/** Raised when Google rejects our credentials and the user must reconnect. */
export class ReauthRequiredError extends Error {
  constructor(message = 'Google authorization is no longer valid') {
    super(message)
    this.name = 'ReauthRequiredError'
  }
}

/** Raised when a syncToken expired and a full resync is required. */
export class SyncTokenExpiredError extends Error {
  constructor() {
    super('Google syncToken expired')
    this.name = 'SyncTokenExpiredError'
  }
}

async function api<T>(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const method = init.method || 'GET'
  // Path only — never the query string, which can carry a syncToken.
  const safePath = path.split('?')[0]
  const t0 = Date.now()

  const res = await fetch(`${CALENDAR_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })

  calLog.debug('api', 'Google Calendar API call', {
    method, path: safePath, status: res.status, duration: Date.now() - t0,
  })

  if (res.status === 401) {
    calLog.warn('api', 'Google returned 401 — grant is no longer valid', { method, path: safePath })
    throw new ReauthRequiredError()
  }
  if (res.status === 410) {
    calLog.warn('api', 'Google returned 410 — sync token expired', { method, path: safePath })
    throw new SyncTokenExpiredError()
  }
  if (res.status === 429) {
    calLog.error('api', 'Google rate limit hit (429)', {
      method, path: safePath,
      retryAfter: res.headers.get('retry-after') || undefined,
    })
  }

  if (res.status === 204) return undefined as T

  const text = await res.text()
  const json = text ? JSON.parse(text) : {}

  if (!res.ok) {
    const message = json?.error?.message || `Google API ${res.status}`
    calLog.error('api', 'Google Calendar API error', {
      method, path: safePath, status: res.status, googleMessage: message,
      reason: json?.error?.errors?.[0]?.reason,
    })
    // 403 from Calendar is usually quota or a revoked grant.
    if (res.status === 403 && /insufficient|permission/i.test(message)) {
      throw new ReauthRequiredError(message)
    }
    throw new Error(message)
  }

  return json as T
}

export async function getGoogleUserInfo(
  accessToken: string,
): Promise<{ sub: string; email: string | null }> {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new ReauthRequiredError('Could not read Google profile')
  const json = (await res.json()) as { sub: string; email?: string }
  return { sub: json.sub, email: json.email || null }
}

interface CalendarListResponse {
  items?: { id: string; summary?: string; primary?: boolean }[]
  nextPageToken?: string
}

/**
 * Find or create the dedicated PlayFunia calendar. Idempotent: matching by
 * summary means a user who already has one from a previous connect is reused
 * rather than accumulating duplicates.
 */
export async function ensureGoogleTargetCalendar(
  accessToken: string,
  name: string,
): Promise<string> {
  let pageToken: string | undefined
  do {
    const qs = new URLSearchParams({ maxResults: '250', minAccessRole: 'owner' })
    if (pageToken) qs.set('pageToken', pageToken)
    const list = await api<CalendarListResponse>(accessToken, `/users/me/calendarList?${qs}`)
    const match = list.items?.find((c) => (c.summary || '').trim() === name)
    if (match) return match.id
    pageToken = list.nextPageToken
  } while (pageToken)

  const created = await api<{ id: string }>(accessToken, '/calendars', {
    method: 'POST',
    body: JSON.stringify({
      summary: name,
      description: 'Shifts, tasks and events synced from PlayFunia.',
      timeZone: 'America/New_York',
    }),
  })

  // Give it a distinct colour so it stands out from personal events.
  try {
    await api(accessToken, `/users/me/calendarList/${encodeURIComponent(created.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ backgroundColor: '#7c3aed', foregroundColor: '#ffffff' }),
      headers: { 'Content-Type': 'application/json' },
    })
  } catch {
    // Colour is cosmetic — never fail a connect over it.
  }

  return created.id
}

export async function deleteGoogleCalendar(accessToken: string, calendarId: string): Promise<void> {
  try {
    await api(accessToken, `/calendars/${encodeURIComponent(calendarId)}`, { method: 'DELETE' })
  } catch {
    // Best-effort cleanup on disconnect.
  }
}

/** Translate one PlayFunia item into a Google event resource. */
function toGoogleEvent(item: PlayfuniaItem, reminderMinutes: number) {
  const base: Record<string, unknown> = {
    summary: item.title,
    description: item.description || undefined,
    location: item.location || undefined,
    status: item.status === 'cancelled' ? 'cancelled' : 'confirmed',
    // Lets us recognise our own events when reading changes back.
    extendedProperties: { private: playfuniaTag(item.sourceType, item.sourceId) },
    // Employees may not edit shifts from inside Google; edits are captured as
    // change requests instead. Locking guests down avoids accidental drags
    // propagating to other attendees.
    guestsCanModify: false,
  }

  if (item.allDay && item.startDate && item.endDate) {
    base.start = { date: item.startDate }
    base.end = { date: item.endDate }
  } else {
    base.start = { dateTime: item.start, timeZone: 'America/New_York' }
    base.end = { dateTime: item.end, timeZone: 'America/New_York' }
  }

  if (!item.remind || reminderMinutes <= 0) {
    base.reminders = { useDefault: false, overrides: [] }
  } else if (item.allDay) {
    // Google measures the offset from midnight for all-day events, so an
    // explicit override would alarm the night before. Defer to the user's own
    // all-day default instead.
    base.reminders = { useDefault: true }
  } else {
    base.reminders = { useDefault: false, overrides: [{ method: 'popup', minutes: reminderMinutes }] }
  }

  return base
}

export async function insertGoogleEvent(
  accessToken: string,
  calendarId: string,
  item: PlayfuniaItem,
  reminderMinutes: number,
): Promise<string> {
  const created = await api<{ id: string }>(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events`,
    { method: 'POST', body: JSON.stringify(toGoogleEvent(item, reminderMinutes)) },
  )
  return created.id
}

export async function updateGoogleEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  item: PlayfuniaItem,
  reminderMinutes: number,
): Promise<string> {
  const updated = await api<{ id: string }>(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: 'PUT', body: JSON.stringify(toGoogleEvent(item, reminderMinutes)) },
  )
  return updated.id
}

export async function deleteGoogleEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  try {
    await api(
      accessToken,
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: 'DELETE' },
    )
  } catch (err) {
    // 404/410 means it is already gone, which is the state we wanted.
    if (err instanceof SyncTokenExpiredError) return
    const message = err instanceof Error ? err.message : ''
    if (/not found|deleted/i.test(message)) return
    throw err
  }
}

interface GoogleEventResource {
  id: string
  status?: string
  summary?: string
  description?: string
  location?: string
  htmlLink?: string
  transparency?: string
  organizer?: { email?: string }
  start?: { date?: string; dateTime?: string }
  end?: { date?: string; dateTime?: string }
  extendedProperties?: { private?: Record<string, string> }
}

interface EventsListResponse {
  items?: GoogleEventResource[]
  nextPageToken?: string
  nextSyncToken?: string
}

function toExternalEvent(ev: GoogleEventResource, calendarId: string): ExternalEvent {
  const allDay = Boolean(ev.start?.date)
  return {
    externalId: ev.id,
    calendarId,
    title: ev.summary || null,
    description: ev.description || null,
    location: ev.location || null,
    startsAt: ev.start?.dateTime || (ev.start?.date ? `${ev.start.date}T00:00:00Z` : null),
    endsAt: ev.end?.dateTime || (ev.end?.date ? `${ev.end.date}T00:00:00Z` : null),
    allDay,
    transparency: ev.transparency || 'opaque',
    status: ev.status || 'confirmed',
    organizerEmail: ev.organizer?.email || null,
    htmlLink: ev.htmlLink || null,
    isPlayfunia: ev.extendedProperties?.private?.app === 'playfunia',
  }
}

export interface ListChangesResult {
  events: ExternalEvent[]
  /** Ids Google reports as cancelled/deleted since the last sync. */
  deletedIds: string[]
  nextSyncToken: string | null
  /** Raw resources, so the caller can inspect our own tagged events. */
  raw: GoogleEventResource[]
}

/**
 * Incremental list. Pass the stored syncToken to get only what changed.
 * Throws SyncTokenExpiredError (Google 410) when the caller must full-resync.
 */
export async function listGoogleChanges(
  accessToken: string,
  calendarId: string,
  syncToken: string | null,
  window: { timeMin: string; timeMax: string },
): Promise<ListChangesResult> {
  const events: ExternalEvent[] = []
  const deletedIds: string[] = []
  const raw: GoogleEventResource[] = []

  let pageToken: string | undefined
  let nextSyncToken: string | null = null

  do {
    const qs = new URLSearchParams({ maxResults: '250', singleEvents: 'true' })
    if (syncToken) {
      // timeMin/timeMax are not allowed alongside a syncToken.
      qs.set('syncToken', syncToken)
    } else {
      qs.set('timeMin', window.timeMin)
      qs.set('timeMax', window.timeMax)
      qs.set('showDeleted', 'false')
    }
    if (pageToken) qs.set('pageToken', pageToken)

    const page = await api<EventsListResponse>(
      accessToken,
      `/calendars/${encodeURIComponent(calendarId)}/events?${qs}`,
    )

    for (const ev of page.items || []) {
      raw.push(ev)
      if (ev.status === 'cancelled') {
        deletedIds.push(ev.id)
      } else {
        events.push(toExternalEvent(ev, calendarId))
      }
    }

    pageToken = page.nextPageToken
    if (page.nextSyncToken) nextSyncToken = page.nextSyncToken
  } while (pageToken)

  return { events, deletedIds, nextSyncToken, raw }
}

/**
 * Open a push channel so Google pings us on change instead of us polling.
 * Channels expire (days, not weeks) and must be renewed by the cron job.
 */
export async function watchGoogleCalendar(
  accessToken: string,
  calendarId: string,
  channelId: string,
  secret: string,
): Promise<{ resourceId: string; expiration: string | null }> {
  const res = await api<{ resourceId: string; expiration?: string }>(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events/watch`,
    {
      method: 'POST',
      body: JSON.stringify({
        id: channelId,
        type: 'web_hook',
        address: `${appBaseUrl()}/api/calendar/webhook/google`,
        token: secret,
        params: { ttl: '604800' }, // 7 days, the practical maximum
      }),
    },
  )
  return {
    resourceId: res.resourceId,
    expiration: res.expiration ? new Date(Number(res.expiration)).toISOString() : null,
  }
}

export async function stopGoogleWatch(
  accessToken: string,
  channelId: string,
  resourceId: string,
): Promise<void> {
  try {
    await api(accessToken, '/channels/stop', {
      method: 'POST',
      body: JSON.stringify({ id: channelId, resourceId }),
    })
  } catch {
    // Channel may already be gone; nothing to clean up.
  }
}
