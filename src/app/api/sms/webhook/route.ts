import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { recordUnsubscribe, recordResubscribe } from '@/lib/sms'

/**
 * Twilio inbound SMS webhook.
 *
 * Twilio POSTs here (application/x-www-form-urlencoded) whenever an employee
 * replies to one of our numbers. We use it to keep our local opt-out registry
 * (sms_unsubscribes) in sync with Twilio's compliance state in real time:
 *
 *   STOP / STOPALL / UNSUBSCRIBE / CANCEL / END / QUIT  -> opt out
 *   START / YES / UNSTOP                                -> opt back in
 *
 * Twilio's Advanced Opt-Out feature already sends the auto-reply and enforces
 * the block at the carrier level; this handler simply mirrors that decision
 * into our DB so we suppress sends locally and have an auditable record.
 *
 * Configure in the Twilio console (Messaging Service > Integration, or the
 * phone number's Messaging webhook) to POST to:
 *   https://admin.playfunia.com/api/sms/webhook
 */

// Keywords Twilio treats as opt-out / opt-in (US carriers).
const STOP_KEYWORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'])
const START_KEYWORDS = new Set(['START', 'YES', 'UNSTOP'])

// Twilio expects a (possibly empty) TwiML response. Empty <Response/> = no reply
// from us (Twilio handles the compliance auto-reply itself).
function twiml(): NextResponse {
  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  })
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text()
    const params = new URLSearchParams(rawBody)

    // ---- Verify the request really came from Twilio ----
    const authToken = process.env.TWILIO_AUTH_TOKEN || ''
    const signature = request.headers.get('x-twilio-signature') || ''
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://admin.playfunia.com'
    const url = `${baseUrl}/api/sms/webhook`

    if (authToken && signature) {
      const paramObj: Record<string, string> = {}
      params.forEach((value, key) => {
        paramObj[key] = value
      })
      const valid = twilio.validateRequest(authToken, signature, url, paramObj)
      if (!valid) {
        console.warn('[SMS webhook] Invalid Twilio signature — rejecting')
        return new NextResponse('Forbidden', { status: 403 })
      }
    } else {
      console.warn('[SMS webhook] No auth token or signature available — skipping signature check')
    }

    const from = params.get('From') || ''
    const body = (params.get('Body') || '').trim()
    const messageSid = params.get('MessageSid') || params.get('SmsSid') || undefined
    // Twilio sets OptOutType (STOP/START/HELP) when Advanced Opt-Out is enabled.
    const optOutType = (params.get('OptOutType') || '').toUpperCase()

    if (!from) {
      console.warn('[SMS webhook] Missing From — ignoring')
      return twiml()
    }

    const keyword = body.toUpperCase().replace(/[^A-Z]/g, '')

    const isStop = optOutType === 'STOP' || STOP_KEYWORDS.has(keyword)
    const isStart = optOutType === 'START' || START_KEYWORDS.has(keyword)

    if (isStop) {
      console.warn(`[SMS webhook] Opt-out from ${from} (keyword="${keyword || optOutType}")`)
      await recordUnsubscribe(from, 'inbound_stop', {
        reason: `Inbound keyword: ${keyword || optOutType || 'STOP'}`,
        messageSid,
      })
    } else if (isStart) {
      console.log(`[SMS webhook] Opt-in from ${from} (keyword="${keyword || optOutType}")`)
      await recordResubscribe(from, { messageSid })
    } else {
      // Any other inbound message — log and ignore (we don't run a conversational flow).
      console.log(`[SMS webhook] Inbound message from ${from}: "${body.slice(0, 120)}"`)
    }

    return twiml()
  } catch (error) {
    console.error('[SMS webhook] Error handling inbound message:', error instanceof Error ? error.message : error)
    // Still return 200/TwiML so Twilio does not retry-storm us on a transient error.
    return twiml()
  }
}
