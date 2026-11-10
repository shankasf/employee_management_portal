import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { generateSecret, hasEncryptionKey } from '@/lib/calendar/crypto'
import { buildGoogleAuthUrl, googleConfigured } from '@/lib/calendar/providers/google'
import { buildMicrosoftAuthUrl, microsoftConfigured } from '@/lib/calendar/providers/microsoft'
import { calLog } from '@/lib/calendar/log'

/**
 * Step 1 of the one-click connect: send the signed-in user to the provider's
 * consent screen. A random state value is mirrored in an httpOnly cookie and
 * verified on the way back, so a third party cannot forge the callback.
 */

export const dynamic = 'force-dynamic'

const STATE_COOKIE = 'calendar_oauth_state'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params

  if (provider !== 'google' && provider !== 'microsoft') {
    calLog.warn('oauth', 'Connect requested for an unsupported provider', { provider })
    return NextResponse.json({ error: 'Unsupported provider' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    calLog.warn('oauth', 'Unauthenticated connect attempt', { provider })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!hasEncryptionKey()) {
    calLog.error('oauth', 'CALENDAR_TOKEN_ENC_KEY is missing — refusing to start OAuth', {
      userId: user.id, provider,
    })
    return NextResponse.json(
      { error: 'Calendar integration is not configured (missing encryption key)' },
      { status: 503 },
    )
  }

  const configured = provider === 'google' ? googleConfigured() : microsoftConfigured()
  if (!configured) {
    calLog.error('oauth', 'Provider OAuth app is not configured', { userId: user.id, provider })
    return NextResponse.json(
      { error: `${provider === 'google' ? 'Google' : 'Microsoft'} calendar is not configured yet` },
      { status: 503 },
    )
  }

  // Where to send the user after the callback finishes.
  const returnTo = request.nextUrl.searchParams.get('returnTo') || ''
  const safeReturn = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : ''

  const nonce = generateSecret(24)
  const state = `${provider}.${nonce}`

  const authUrl =
    provider === 'google' ? buildGoogleAuthUrl(state) : buildMicrosoftAuthUrl(state)

  const cookieStore = await cookies()
  cookieStore.set(STATE_COOKIE, `${state}|${safeReturn}`, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600, // 10 minutes to complete consent
  })

  calLog.info('oauth', 'Redirecting user to provider consent screen', {
    userId: user.id, provider, returnTo: safeReturn || undefined,
  })

  return NextResponse.redirect(authUrl)
}
