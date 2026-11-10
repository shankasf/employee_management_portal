import { serverLog } from '@/lib/server-log'

/**
 * Calendar-scoped logging.
 *
 * Every line is prefixed `CALENDAR:<area>` so PM2 logs can be filtered down to
 * one part of the pipeline:
 *
 *   pm2 logs playfunia-employee | grep CALENDAR
 *   pm2 logs playfunia-employee | grep 'CALENDAR:push'
 *   pm2 logs playfunia-employee | grep 'CALENDAR:oauth'
 *
 * Areas: oauth, push, pull, token, watch, webhook, feed, cron, prefs, api.
 *
 * NEVER pass a token, secret or refresh token into `data` — use redact() if
 * you need to prove a value was present.
 */

export type CalendarLogArea =
  | 'oauth'
  | 'push'
  | 'pull'
  | 'token'
  | 'watch'
  | 'webhook'
  | 'feed'
  | 'cron'
  | 'prefs'
  | 'api'
  | 'edits'

interface CalendarLogData {
  userId?: string
  connectionId?: string
  provider?: string
  duration?: number
  error?: unknown
  [key: string]: unknown
}

function split(data?: CalendarLogData) {
  if (!data) return { userId: undefined, duration: undefined, error: undefined, rest: undefined }
  const { userId, duration, error, ...rest } = data
  return {
    userId,
    duration,
    error,
    rest: Object.keys(rest).length ? rest : undefined,
  }
}

function category(area: CalendarLogArea): string {
  return `CALENDAR:${area}`
}

export const calLog = {
  info(area: CalendarLogArea, message: string, data?: CalendarLogData) {
    const { userId, duration, rest } = split(data)
    serverLog.info(category(area), message, { userId, duration, data: rest })
  },

  warn(area: CalendarLogArea, message: string, data?: CalendarLogData) {
    const { userId, duration, error, rest } = split(data)
    serverLog.warn(category(area), message, { userId, duration, error, data: rest })
  },

  error(area: CalendarLogArea, message: string, data?: CalendarLogData) {
    const { userId, duration, error, rest } = split(data)
    serverLog.error(category(area), message, { userId, duration, error, data: rest })
  },

  /** Verbose per-item tracing. Only emitted when DEBUG_LOGS=true in production. */
  debug(area: CalendarLogArea, message: string, data?: CalendarLogData) {
    const { userId, duration, rest } = split(data)
    serverLog.debug(category(area), message, { userId, duration, data: rest })
  },
}

/** Prove a secret was present without ever writing it to a log. */
export function redact(value: string | null | undefined): string {
  if (!value) return 'none'
  return `present(len=${value.length})`
}

/** Wall-clock helper so every operation can report a duration. */
export function startTimer(): () => number {
  const t0 = Date.now()
  return () => Date.now() - t0
}
