import { ReauthRequiredError, SyncTokenExpiredError, appBaseUrl } from './google'
import type { ExternalEvent, PlayfuniaItem } from '../types'
import { calLog } from '../log'

/**
 * Microsoft 365 / Outlook.com calendar integration over Microsoft Graph.
 *
 * Mirrors the Google provider's model: a dedicated "PlayFunia" calendar for
 * our events, plus a read of the default calendar for the unified view.
 *
 * Graph differences worth knowing:
 *  - incremental sync uses a deltaLink (an opaque URL) rather than a token
 *  - subscriptions expire in ~3 days for calendars and must be renewed
 *  - our own events are identified by the calendar they live in, so no
 *    extended-property tagging is needed
 */

const GRAPH = 'https://graph.microsoft.com/v1.0'

function tenant(): string {
  return process.env.MICROSOFT_TENANT_ID || 'common'
}

function authBase(): string {
  return `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0`
}

export const MICROSOFT_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'Calendars.ReadWrite',
].join(' ')

export function microsoftConfigured(): boolean {
  return Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET)
}

function clientId(): string {
  const id = process.env.MICROSOFT_CLIENT_ID
  if (!id) throw new Error('Microsoft client id is not configured')
  return id
}

function clientSecret(): string {
  const secret = process.env.MICROSOFT_CLIENT_SECRET
  if (!secret) throw new Error('Microsoft client secret is not configured')
  return secret
}

export function microsoftRedirectUri(): string {
  return `${appBaseUrl()}/api/calendar/callback/microsoft`
}

export function buildMicrosoftAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    response_type: 'code',
    redirect_uri: microsoftRedirectUri(),
    response_mode: 'query',
    scope: MICROSOFT_SCOPES,
    state,
  })
  return `${authBase()}/authorize?${params.toString()}`
}

export interface TokenResponse {
  accessToken: string
  refreshToken: string | null
  expiresAt: string
  scope: string | null
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${authBase()}/token`, {
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
    throw new Error(`Microsoft token request failed: ${json.error || res.status}`)
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token || null,
    expiresAt: new Date(Date.now() + (json.expires_in ?? 3600) * 1000).toISOString(),
    scope: json.scope || null,
  }
}

export function exchangeMicrosoftCode(code: string): Promise<TokenResponse> {
  return tokenRequest({
    code,
    client_id: clientId(),
    client_secret: clientSecret(),
    redirect_uri: microsoftRedirectUri(),
    grant_type: 'authorization_code',
    scope: MICROSOFT_SCOPES,
  })
}

export function refreshMicrosoftToken(refreshToken: string): Promise<TokenResponse> {
  return tokenRequest({
    refresh_token: refreshToken,
    client_id: clientId(),
    client_secret: clientSecret(),
    grant_type: 'refresh_token',
    scope: MICROSOFT_SCOPES,
  })
}

async function graph<T>(accessToken: string, path: string, init: RequestInit = {}): Promise<T> {
  const url = path.startsWith('http') ? path : `${GRAPH}${path}`
  const method = init.method || 'GET'
  // A deltaLink is an opaque URL carrying a token — log the path only.
  const safePath = url.replace(GRAPH, '').split('?')[0]
  const t0 = Date.now()

  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })

  calLog.debug('api', 'Microsoft Graph call', {
    method, path: safePath, status: res.status, duration: Date.now() - t0,
  })

  if (res.status === 401) {
    calLog.warn('api', 'Graph returned 401 — grant is no longer valid', { method, path: safePath })
    throw new ReauthRequiredError('Microsoft authorization is no longer valid')
  }
  if (res.status === 410) {
    calLog.warn('api', 'Graph returned 410 — delta link expired', { method, path: safePath })
    throw new SyncTokenExpiredError()
  }
  if (res.status === 429) {
    calLog.error('api', 'Graph rate limit hit (429)', {
      method, path: safePath, retryAfter: res.headers.get('retry-after') || undefined,
    })
  }
  if (res.status === 204) return undefined as T

  const text = await res.text()
  const json = text ? JSON.parse(text) : {}

  if (!res.ok) {
    const message = json?.error?.message || `Microsoft Graph ${res.status}`
    calLog.error('api', 'Microsoft Graph error', {
      method, path: safePath, status: res.status,
      graphMessage: message, code: json?.error?.code,
    })
    throw new Error(message)
  }

  return json as T
}

export async function getMicrosoftUserInfo(
  accessToken: string,
): Promise<{ sub: string; email: string | null }> {
  const me = await graph<{ id: string; mail?: string; userPrincipalName?: string }>(
    accessToken,
    '/me?$select=id,mail,userPrincipalName',
  )
  return { sub: me.id, email: me.mail || me.userPrincipalName || null }
}

export async function ensureMicrosoftTargetCalendar(
  accessToken: string,
  name: string,
): Promise<string> {
  const list = await graph<{ value: { id: string; name: string }[] }>(
    accessToken,
    '/me/calendars?$select=id,name&$top=100',
  )
  const match = list.value?.find((c) => (c.name || '').trim() === name)
  if (match) return match.id

  const created = await graph<{ id: string }>(accessToken, '/me/calendars', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
  return created.id
}

export async function deleteMicrosoftCalendar(
  accessToken: string,
  calendarId: string,
): Promise<void> {
  try {
    await graph(accessToken, `/me/calendars/${encodeURIComponent(calendarId)}`, {
      method: 'DELETE',
    })
  } catch {
    // Best-effort cleanup on disconnect.
  }
}

/** Graph wants naive local date-times plus a separate timeZone field. */
function toGraphDateTime(iso: string) {
  return {
    dateTime: new Date(iso).toISOString().replace('Z', ''),
    timeZone: 'UTC',
  }
}

function toGraphEvent(item: PlayfuniaItem, reminderMinutes: number) {
  const body: Record<string, unknown> = {
    subject: item.title,
    body: { contentType: 'text', content: item.description || '' },
    location: item.location ? { displayName: item.location } : undefined,
    isReminderOn: item.remind && reminderMinutes > 0,
    reminderMinutesBeforeStart: item.remind && reminderMinutes > 0 ? reminderMinutes : undefined,
    showAs: 'busy',
    // Employees cannot rewrite a shift from Outlook; edits become requests.
    allowNewTimeProposals: false,
  }

  if (item.allDay && item.startDate && item.endDate) {
    body.isAllDay = true
    body.start = { dateTime: `${item.startDate}T00:00:00`, timeZone: 'America/New_York' }
    body.end = { dateTime: `${item.endDate}T00:00:00`, timeZone: 'America/New_York' }
  } else if (item.start && item.end) {
    body.isAllDay = false
    body.start = toGraphDateTime(item.start)
    body.end = toGraphDateTime(item.end)
  }

  return body
}

export async function insertMicrosoftEvent(
  accessToken: string,
  calendarId: string,
  item: PlayfuniaItem,
  reminderMinutes: number,
): Promise<string> {
  const created = await graph<{ id: string }>(
    accessToken,
    `/me/calendars/${encodeURIComponent(calendarId)}/events`,
    { method: 'POST', body: JSON.stringify(toGraphEvent(item, reminderMinutes)) },
  )
  return created.id
}

export async function updateMicrosoftEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  item: PlayfuniaItem,
  reminderMinutes: number,
): Promise<string> {
  const updated = await graph<{ id: string }>(
    accessToken,
    `/me/events/${encodeURIComponent(eventId)}`,
    { method: 'PATCH', body: JSON.stringify(toGraphEvent(item, reminderMinutes)) },
  )
  return updated?.id || eventId
}

export async function deleteMicrosoftEvent(
  accessToken: string,
  _calendarId: string,
  eventId: string,
): Promise<void> {
  try {
    await graph(accessToken, `/me/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' })
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (/not found|does not exist/i.test(message)) return
    throw err
  }
}

interface GraphEvent {
  id: string
  subject?: string
  bodyPreview?: string
  location?: { displayName?: string }
  start?: { dateTime?: string; timeZone?: string }
  end?: { dateTime?: string; timeZone?: string }
  isAllDay?: boolean
  showAs?: string
  isCancelled?: boolean
  organizer?: { emailAddress?: { address?: string } }
  webLink?: string
  '@removed'?: { reason?: string }
}

function graphToIso(dt?: { dateTime?: string; timeZone?: string }): string | null {
  if (!dt?.dateTime) return null
  // Graph returns UTC when we request it via the Prefer header below.
  const raw = dt.dateTime.endsWith('Z') ? dt.dateTime : `${dt.dateTime}Z`
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function toExternalEvent(ev: GraphEvent, calendarId: string, isPlayfunia: boolean): ExternalEvent {
  return {
    externalId: ev.id,
    calendarId,
    title: ev.subject || null,
    description: ev.bodyPreview || null,
    location: ev.location?.displayName || null,
    startsAt: graphToIso(ev.start),
    endsAt: graphToIso(ev.end),
    allDay: Boolean(ev.isAllDay),
    transparency: ev.showAs === 'free' ? 'transparent' : 'opaque',
    status: ev.isCancelled ? 'cancelled' : 'confirmed',
    organizerEmail: ev.organizer?.emailAddress?.address || null,
    htmlLink: ev.webLink || null,
    isPlayfunia,
  }
}

export interface MicrosoftChangesResult {
  events: ExternalEvent[]
  deletedIds: string[]
  /** Opaque deltaLink to store and pass in next time. */
  nextSyncToken: string | null
}

/**
 * Delta query over a calendar view. Pass the stored deltaLink to fetch only
 * changes; pass null for an initial sync over the given window.
 */
export async function listMicrosoftChanges(
  accessToken: string,
  calendarId: string,
  deltaLink: string | null,
  window: { timeMin: string; timeMax: string },
  isPlayfuniaCalendar: boolean,
): Promise<MicrosoftChangesResult> {
  const events: ExternalEvent[] = []
  const deletedIds: string[] = []

  let url: string
  if (deltaLink) {
    url = deltaLink
  } else {
    const qs = new URLSearchParams({
      startDateTime: window.timeMin,
      endDateTime: window.timeMax,
    })
    url = `${GRAPH}/me/calendars/${encodeURIComponent(calendarId)}/calendarView/delta?${qs}`
  }

  let nextSyncToken: string | null = null

  // Ask Graph to return times in UTC so graphToIso is safe.
  const headers = { Prefer: 'outlook.timezone="UTC"' }

  while (url) {
    const page: {
      value?: GraphEvent[]
      '@odata.nextLink'?: string
      '@odata.deltaLink'?: string
    } = await graph(accessToken, url, { headers })

    for (const ev of page.value || []) {
      if (ev['@removed']) {
        deletedIds.push(ev.id)
      } else {
        events.push(toExternalEvent(ev, calendarId, isPlayfuniaCalendar))
      }
    }

    if (page['@odata.deltaLink']) {
      nextSyncToken = page['@odata.deltaLink']
      break
    }
    url = page['@odata.nextLink'] || ''
  }

  return { events, deletedIds, nextSyncToken }
}

/** Graph change subscription (their push notifications). Expires in ~3 days. */
export async function subscribeMicrosoftCalendar(
  accessToken: string,
  calendarId: string,
  secret: string,
): Promise<{ subscriptionId: string; expiration: string }> {
  const expiration = new Date(Date.now() + 2.5 * 24 * 3600 * 1000).toISOString()
  const res = await graph<{ id: string; expirationDateTime: string }>(
    accessToken,
    '/subscriptions',
    {
      method: 'POST',
      body: JSON.stringify({
        changeType: 'created,updated,deleted',
        notificationUrl: `${appBaseUrl()}/api/calendar/webhook/microsoft`,
        resource: `/me/calendars/${calendarId}/events`,
        expirationDateTime: expiration,
        clientState: secret,
      }),
    },
  )
  return { subscriptionId: res.id, expiration: res.expirationDateTime || expiration }
}

export async function renewMicrosoftSubscription(
  accessToken: string,
  subscriptionId: string,
): Promise<string> {
  const expiration = new Date(Date.now() + 2.5 * 24 * 3600 * 1000).toISOString()
  await graph(accessToken, `/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ expirationDateTime: expiration }),
  })
  return expiration
}

export async function deleteMicrosoftSubscription(
  accessToken: string,
  subscriptionId: string,
): Promise<void> {
  try {
    await graph(accessToken, `/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      method: 'DELETE',
    })
  } catch {
    // Already expired or removed.
  }
}
