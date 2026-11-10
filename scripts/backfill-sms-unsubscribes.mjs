// Backfill the sms_unsubscribes registry from Twilio's message history.
//
// Scans recent outbound messages for Twilio error code 21610 ("Attempt to send
// to unsubscribed recipient") and records each affected number as opted out, so
// we stop attempting to text them going forward. Safe to re-run (idempotent
// upsert on the unique `phone` column).
//
// Usage:
//   node scripts/backfill-sms-unsubscribes.mjs            # last 90 days
//   node scripts/backfill-sms-unsubscribes.mjs 30         # last 30 days
//   DRY_RUN=1 node scripts/backfill-sms-unsubscribes.mjs  # report only, no writes

import fs from 'node:fs'
import twilio from 'twilio'

const env = fs.readFileSync('.env.local', 'utf8').split('\n').reduce((acc, line) => {
  const m = line.match(/^([^=#]+)=(.*)$/)
  if (m) acc[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
  return acc
}, {})

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
const ACCOUNT_SID = env.TWILIO_ACCOUNT_SID
const API_KEY_SID = env.TWILIO_API_KEY_SID
const API_KEY_SECRET = env.TWILIO_API_KEY_SECRET
const AUTH_TOKEN = env.TWILIO_AUTH_TOKEN

const UNSUBSCRIBED_CODE = 21610
const DRY_RUN = !!process.env.DRY_RUN
const days = parseInt(process.argv[2] || '90', 10)

const client = API_KEY_SID && API_KEY_SECRET
  ? twilio(API_KEY_SID, API_KEY_SECRET, { accountSid: ACCOUNT_SID })
  : twilio(ACCOUNT_SID, AUTH_TOKEN)

const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
console.log(`Scanning Twilio messages since ${since.toISOString()} for error ${UNSUBSCRIBED_CODE}...`)

// Pull messages and collect numbers that hit 21610.
const offenders = new Map() // phone -> { sid, dateSent }
const messages = await client.messages.list({ dateSentAfter: since, limit: 5000 })
for (const m of messages) {
  if (m.errorCode === UNSUBSCRIBED_CODE && m.to) {
    if (!offenders.has(m.to)) offenders.set(m.to, { sid: m.sid, dateSent: m.dateSent })
  }
}

console.log(`Found ${offenders.size} distinct number(s) with a ${UNSUBSCRIBED_CODE} failure.`)
if (offenders.size === 0) process.exit(0)

if (DRY_RUN) {
  for (const [phone, info] of offenders) console.log(`  [dry-run] would suppress ${phone} (sid ${info.sid})`)
  process.exit(0)
}

const supaHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'resolution=merge-duplicates', // upsert on unique constraint
}

const nowIso = new Date().toISOString()
const rows = [...offenders.entries()].map(([phone, info]) => ({
  phone,
  active: true,
  reason: 'Backfilled from Twilio 21610 history',
  source: 'twilio_21610',
  last_message_sid: info.sid,
  unsubscribed_at: nowIso,
  resubscribed_at: null,
  updated_at: nowIso,
}))

const res = await fetch(`${SUPABASE_URL}/rest/v1/sms_unsubscribes?on_conflict=phone`, {
  method: 'POST',
  headers: supaHeaders,
  body: JSON.stringify(rows),
})

if (!res.ok) {
  console.error('Upsert failed:', res.status, await res.text())
  process.exit(1)
}

console.log(`✓ Recorded ${rows.length} opt-out(s) in sms_unsubscribes.`)
