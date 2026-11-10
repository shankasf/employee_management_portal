import type { PlayfuniaItem } from './types'

/**
 * RFC 5545 ICS generation.
 *
 * Used for two things:
 *  - the per-user subscription feed (webcal://…) that Apple Calendar, Outlook
 *    and Google can subscribe to without any OAuth
 *  - single-event "add to calendar" downloads
 *
 * Subscribed feeds are refreshed by the CLIENT on its own schedule (Apple and
 * Google poll roughly every few hours up to a day), so this is a best-effort
 * mirror, not real-time. Real-time updates come from the OAuth path.
 */

const PRODID = '-//PlayFunia//Employee Management//EN'

/** Escape a value for an ICS text field (RFC 5545 §3.3.11). */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/** Fold lines at 75 octets as the spec requires, or Outlook truncates them. */
function foldLine(line: string): string {
  const bytes = Buffer.from(line, 'utf8')
  if (bytes.length <= 75) return line

  const chunks: string[] = []
  let offset = 0
  let limit = 75
  while (offset < bytes.length) {
    let end = Math.min(offset + limit, bytes.length)
    // Never split a multi-byte UTF-8 character.
    while (end > offset && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--
    chunks.push(bytes.subarray(offset, end).toString('utf8'))
    offset = end
    limit = 74 // continuation lines start with a space
  }
  return chunks.join('\r\n ')
}

/** UTC timestamp in ICS basic format: 20260829T143000Z */
function toIcsUtc(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/** Date-only value: 20260829 */
function toIcsDate(dateStr: string): string {
  return dateStr.replace(/-/g, '')
}

/** Stable UID so re-subscribing updates rather than duplicates events. */
function uidFor(item: PlayfuniaItem): string {
  return `${item.sourceType}-${item.sourceId}@playfunia`
}

export interface IcsOptions {
  calendarName?: string
  /** Minutes before start to alarm. 0 or null disables alarms. */
  reminderMinutes?: number | null
  /** Hint to clients for how often to re-poll. */
  refreshIntervalMinutes?: number
}

function buildEvent(item: PlayfuniaItem, opts: IcsOptions, stamp: string): string[] {
  const lines: string[] = ['BEGIN:VEVENT']

  lines.push(`UID:${uidFor(item)}`)
  lines.push(`DTSTAMP:${stamp}`)

  if (item.allDay && item.startDate) {
    lines.push(`DTSTART;VALUE=DATE:${toIcsDate(item.startDate)}`)
    if (item.endDate) lines.push(`DTEND;VALUE=DATE:${toIcsDate(item.endDate)}`)
  } else if (item.start) {
    lines.push(`DTSTART:${toIcsUtc(item.start)}`)
    if (item.end) lines.push(`DTEND:${toIcsUtc(item.end)}`)
  }

  lines.push(`SUMMARY:${escapeText(item.title)}`)
  if (item.description) lines.push(`DESCRIPTION:${escapeText(item.description)}`)
  if (item.location) lines.push(`LOCATION:${escapeText(item.location)}`)

  // Cancelled shifts stay in the feed as CANCELLED so subscribers clear them;
  // dropping the row silently leaves a stale event on the phone.
  const cancelled = item.status === 'cancelled'
  lines.push(`STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`)
  if (cancelled) lines.push('METHOD:CANCEL')

  lines.push(`CATEGORIES:${item.sourceType.toUpperCase()}`)
  lines.push('TRANSP:OPAQUE')

  const remind = opts.reminderMinutes
  if (item.remind && !cancelled && remind && remind > 0) {
    lines.push('BEGIN:VALARM')
    lines.push('ACTION:DISPLAY')
    lines.push(`DESCRIPTION:${escapeText(item.title)}`)
    // An all-day item starts at midnight, so "60 minutes before" would alarm at
    // 11pm the night before. Fire at 9am on the day itself instead.
    lines.push(item.allDay ? 'TRIGGER:PT9H' : `TRIGGER:-PT${remind}M`)
    lines.push('END:VALARM')
  }

  lines.push('END:VEVENT')
  return lines
}

/** Build a full VCALENDAR document from PlayFunia items. */
export function buildIcs(items: PlayfuniaItem[], opts: IcsOptions = {}): string {
  const {
    calendarName = 'PlayFunia',
    refreshIntervalMinutes = 60,
  } = opts

  const stamp = toIcsUtc(new Date().toISOString())

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    `X-WR-CALDESC:${escapeText('Your PlayFunia shifts, tasks and events')}`,
    'X-WR-TIMEZONE:America/New_York',
    // Both spellings — Apple honours REFRESH-INTERVAL, Outlook X-PUBLISHED-TTL.
    `REFRESH-INTERVAL;VALUE=DURATION:PT${refreshIntervalMinutes}M`,
    `X-PUBLISHED-TTL:PT${refreshIntervalMinutes}M`,
  ]

  for (const item of items) {
    lines.push(...buildEvent(item, opts, stamp))
  }

  lines.push('END:VCALENDAR')

  return lines.map(foldLine).join('\r\n') + '\r\n'
}

/** Build a one-event .ics file for a download button. */
export function buildSingleEventIcs(item: PlayfuniaItem, opts: IcsOptions = {}): string {
  return buildIcs([item], { ...opts, calendarName: item.title })
}
