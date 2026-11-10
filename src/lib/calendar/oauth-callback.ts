import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { encryptToken, safeEqual } from './crypto'
import { DEFAULT_SYNC_PREFS, type CalendarProvider } from './types'
import { ensureWatch, getConnection, syncConnection } from './sync'
import * as google from './providers/google'
import * as microsoft from './providers/microsoft'
import { calendarDb } from './db'
import { calLog, startTimer } from './log'

/**
 * Shared OAuth callback: verify state, exchange the code, create the dedicated
 * PlayFunia calendar, store encrypted tokens, then kick off the first sync.
 */

const STATE_COOKIE = 'calendar_oauth_state'

function settingsUrl(role: 'admin' | 'employee', query: string, returnTo: string): string {
  const base = returnTo || `/${role}/settings`
  return `${base}${base.includes('?') ? '&' : '?'}${query}`
}

export async function handleOAuthCallback(
  request: NextRequest,
  provider: CalendarProvider,
): Promise<NextResponse> {
  const origin = (process.env.NEXT_PUBLIC_APP_URL || 'https://admin.playfunia.com').replace(/\/$/, '')
  const cookieStore = await cookies()
  const stored = cookieStore.get(STATE_COOKIE)?.value || ''
  cookieStore.delete(STATE_COOKIE)

  const [storedState, storedReturn = ''] = stored.split('|')
  const returnedState = request.nextUrl.searchParams.get('state') || ''
  const code = request.nextUrl.searchParams.get('code')
  const oauthError = request.nextUrl.searchParams.get('error')

  const elapsed = startTimer()
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    calLog.warn('oauth', 'Callback hit with no signed-in session', {
      provider, hasCode: Boolean(request.nextUrl.searchParams.get('code')),
    })
    return NextResponse.redirect(`${origin}/login`)
  }

  calLog.info('oauth', 'OAuth callback received', {
    userId: user.id, provider,
    hasCode: Boolean(code), hasState: Boolean(returnedState),
    oauthError: oauthError || undefined,
  })

  const service = await calendarDb()
  const { data: profileRaw } = await service
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  const role = ((profileRaw as { role?: string } | null)?.role === 'admin' ? 'admin' : 'employee') as
    | 'admin'
    | 'employee'

  const fail = (reason: string) => {
    calLog.error('oauth', 'Connect failed', {
      userId: user.id, provider, reason, duration: elapsed(),
    })
    return NextResponse.redirect(
      `${origin}${settingsUrl(role, `calendar_error=${encodeURIComponent(reason)}`, storedReturn)}`,
    )
  }

  if (oauthError) return fail(oauthError === 'access_denied' ? 'You declined the request' : oauthError)
  if (!code) return fail('No authorization code returned')
  if (!storedState || !returnedState || !safeEqual(storedState, returnedState)) {
    return fail('Security check failed, please try connecting again')
  }
  if (!storedState.startsWith(`${provider}.`)) {
    return fail('Provider mismatch, please try again')
  }

  try {
    const tokens =
      provider === 'google'
        ? await google.exchangeGoogleCode(code)
        : await microsoft.exchangeMicrosoftCode(code)

    const info =
      provider === 'google'
        ? await google.getGoogleUserInfo(tokens.accessToken)
        : await microsoft.getMicrosoftUserInfo(tokens.accessToken)

    calLog.info('oauth', 'Token exchange succeeded', {
      userId: user.id, provider,
      gotRefreshToken: Boolean(tokens.refreshToken),
      account: info.email || undefined,
      scopes: tokens.scope || undefined,
    })

    const calendarName = 'PlayFunia'
    const calendarId =
      provider === 'google'
        ? await google.ensureGoogleTargetCalendar(tokens.accessToken, calendarName)
        : await microsoft.ensureMicrosoftTargetCalendar(tokens.accessToken, calendarName)

    // Preserve an existing refresh token when the provider omits one on
    // re-consent, otherwise reconnecting would silently break background sync.
    const existing = await getConnection(user.id, provider)
    const refreshEnc = tokens.refreshToken
      ? encryptToken(tokens.refreshToken)
      : existing?.refresh_token_enc ?? null

    if (!refreshEnc) {
      return fail('No offline access was granted — try again and allow the request')
    }

    const { error: upsertError } = await service.from('calendar_connections').upsert(
      {
        user_id: user.id,
        provider,
        provider_account_id: info.sub,
        provider_account_email: info.email,
        access_token_enc: encryptToken(tokens.accessToken),
        refresh_token_enc: refreshEnc,
        token_expires_at: tokens.expiresAt,
        scopes: tokens.scope,
        target_calendar_id: calendarId,
        target_calendar_name: calendarName,
        // A fresh grant invalidates old incremental cursors.
        sync_token: null,
        status: 'active',
        last_error: null,
      },
      { onConflict: 'user_id,provider' },
    )

    if (upsertError) {
      calLog.error('oauth', 'Failed to upsert calendar connection', {
        userId: user.id, provider, error: upsertError,
      })
      return fail('Could not save the connection, please try again')
    }

    calLog.info('oauth', 'Connection saved, target calendar ready', {
      userId: user.id, provider, targetCalendarId: calendarId,
    })

    // Make sure the user has a preferences row so the settings UI has state.
    await service
      .from('calendar_sync_prefs')
      .upsert({ user_id: user.id, ...DEFAULT_SYNC_PREFS }, { onConflict: 'user_id', ignoreDuplicates: true })

    const conn = await getConnection(user.id, provider)
    if (conn) {
      // First sync inline so the user sees their shifts immediately, then open
      // the push channel. Neither failure should break the connect flow.
      try {
        await syncConnection(conn)
      } catch (err) {
        /* surfaced via connection.last_error */
        calLog.error('oauth', 'First sync after connect failed', {
          userId: user.id, connectionId: conn.id, provider, error: err,
        })
      }
      try {
        await ensureWatch(conn)
      } catch (err) {
        /* the cron fallback keeps things fresh without a live channel */
        calLog.warn('oauth', 'Could not open push channel after connect — cron will cover it', {
          userId: user.id, connectionId: conn.id, provider, error: err,
        })
      }
    }

    calLog.info('oauth', 'Connect complete', {
      userId: user.id, provider, duration: elapsed(),
    })

    return NextResponse.redirect(
      `${origin}${settingsUrl(role, `calendar_connected=${provider}`, storedReturn)}`,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Connection failed'
    calLog.error('oauth', 'Unhandled error during connect', {
      userId: user.id, provider, duration: elapsed(), error: err,
    })
    return fail(message.slice(0, 140))
  }
}
