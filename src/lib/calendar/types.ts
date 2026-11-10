/** Shared types for calendar integration. */

export type CalendarProvider = 'google' | 'microsoft'

export type CalendarSourceType = 'schedule' | 'task' | 'event' | 'birthday' | 'onboarding'

export type ConnectionStatus = 'active' | 'needs_reauth' | 'revoked' | 'error'

/**
 * A PlayFunia item normalised for pushing into an external calendar or an ICS
 * feed. Times are UTC ISO strings; all-day items use `date` (YYYY-MM-DD).
 */
export interface PlayfuniaItem {
  sourceType: CalendarSourceType
  sourceId: string
  userId: string
  title: string
  description: string | null
  location: string | null
  /** UTC ISO — null for all-day items. */
  start: string | null
  end: string | null
  /** YYYY-MM-DD — set only for all-day items. */
  startDate?: string
  endDate?: string
  allDay: boolean
  status: string
  /** Skip reminders for low-priority items like birthdays. */
  remind: boolean
}

/** An event read back from a connected external calendar. */
export interface ExternalEvent {
  externalId: string
  calendarId: string | null
  title: string | null
  description: string | null
  location: string | null
  startsAt: string | null
  endsAt: string | null
  allDay: boolean
  transparency: string | null
  status: string | null
  organizerEmail: string | null
  htmlLink: string | null
  isPlayfunia: boolean
}

export interface CalendarConnectionRow {
  id: string
  user_id: string
  provider: CalendarProvider
  provider_account_id: string | null
  provider_account_email: string | null
  access_token_enc: string | null
  refresh_token_enc: string | null
  token_expires_at: string | null
  scopes: string | null
  target_calendar_id: string | null
  target_calendar_name: string
  sync_token: string | null
  watch_channel_id: string | null
  watch_resource_id: string | null
  watch_secret: string | null
  watch_expires_at: string | null
  status: ConnectionStatus
  last_synced_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

export interface CalendarSyncPrefs {
  user_id: string
  sync_shifts: boolean
  sync_tasks: boolean
  sync_events: boolean
  sync_birthdays: boolean
  sync_onboarding: boolean
  share_external_with_admin: boolean
  share_external_details: boolean
  reminder_minutes: number
}

export const DEFAULT_SYNC_PREFS: Omit<CalendarSyncPrefs, 'user_id'> = {
  sync_shifts: true,
  sync_tasks: true,
  sync_events: true,
  sync_birthdays: false,
  sync_onboarding: false,
  share_external_with_admin: false,
  share_external_details: false,
  reminder_minutes: 60,
}

/** Unified entry rendered by My Calendar / Employee Calendar. */
export interface UnifiedCalendarEntry {
  id: string
  source: 'playfunia' | 'external'
  sourceType: CalendarSourceType | 'external'
  provider?: CalendarProvider
  userId: string
  userName?: string
  title: string
  description?: string | null
  location?: string | null
  start: string | null
  end: string | null
  allDay: boolean
  status?: string | null
  /** True when details are hidden and only a busy block should render. */
  busyOnly?: boolean
}

/** Tag we put on every event we create, so we can recognise our own events. */
export const PLAYFUNIA_TAG = 'playfunia'

/** Build the private-property payload identifying one of our events. */
export function playfuniaTag(sourceType: CalendarSourceType, sourceId: string) {
  return {
    app: PLAYFUNIA_TAG,
    source_type: sourceType,
    source_id: sourceId,
  }
}
