import fs from 'node:fs'
import twilio from 'twilio'

const envFile = fs.readFileSync('.env.local', 'utf8')
const env = envFile.split('\n').reduce((acc, line) => {
  const m = line.match(/^([^=#]+)=(.*)$/)
  if (m) acc[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
  return acc
}, {})

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
const TWILIO_ACCOUNT_SID = env.TWILIO_ACCOUNT_SID
const TWILIO_API_KEY_SID = env.TWILIO_API_KEY_SID
const TWILIO_API_KEY_SECRET = env.TWILIO_API_KEY_SECRET
const TWILIO_AUTH_TOKEN = env.TWILIO_AUTH_TOKEN
const TWILIO_MESSAGING_SERVICE_SID = env.TWILIO_MESSAGING_SERVICE_SID
const TWILIO_PHONE_NUMBER = env.TWILIO_PHONE_NUMBER

const BODY = 'Playfunia: This is a sample test message. Reply STOP to opt out.'

function formatPhoneNumber(phone) {
  if (!phone) return null
  let cleaned = phone.replace(/[^\d+]/g, '')
  if (!cleaned.startsWith('+')) {
    if (cleaned.startsWith('1') && cleaned.length === 11) cleaned = cleaned.substring(1)
    if (cleaned.length === 10) cleaned = '+1' + cleaned
  }
  return /^\+\d{10,15}$/.test(cleaned) ? cleaned : null
}

const supaHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }

const profilesRes = await fetch(
  `${SUPABASE_URL}/rest/v1/profiles?status=eq.active&select=id,full_name,role`,
  { headers: supaHeaders },
)
const profiles = await profilesRes.json()

const empsRes = await fetch(
  `${SUPABASE_URL}/rest/v1/employees?select=id,phone_number`,
  { headers: supaHeaders },
)
const emps = await empsRes.json()
const phoneById = Object.fromEntries(emps.map(e => [e.id, e.phone_number]))

const recipients = profiles
  .map(p => ({
    name: p.full_name,
    role: p.role,
    raw: phoneById[p.id],
    phone: formatPhoneNumber(phoneById[p.id]),
  }))
  .filter(r => r.phone)

const skipped = profiles
  .map(p => ({ name: p.full_name, role: p.role, raw: phoneById[p.id], phone: formatPhoneNumber(phoneById[p.id]) }))
  .filter(r => !r.phone)

console.log(`Recipients with valid phone: ${recipients.length}`)
console.log(`Skipped (no/invalid phone): ${skipped.length}`)
skipped.forEach(s => console.log(`  - ${s.name} (${s.role}) raw=${JSON.stringify(s.raw)}`))

const client = TWILIO_API_KEY_SID && TWILIO_API_KEY_SECRET
  ? twilio(TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, { accountSid: TWILIO_ACCOUNT_SID })
  : twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)

let ok = 0, fail = 0
for (const r of recipients) {
  try {
    const opts = { body: BODY, to: r.phone }
    if (TWILIO_MESSAGING_SERVICE_SID) opts.messagingServiceSid = TWILIO_MESSAGING_SERVICE_SID
    else opts.from = TWILIO_PHONE_NUMBER
    const msg = await client.messages.create(opts)
    console.log(`OK  ${r.role.padEnd(8)} ${r.name?.padEnd(28) || ''} ${r.phone}  sid=${msg.sid}`)
    ok++
  } catch (err) {
    console.log(`ERR ${r.role.padEnd(8)} ${r.name?.padEnd(28) || ''} ${r.phone}  ${err.message}`)
    fail++
  }
}

console.log(`\nDone. Sent: ${ok}, Failed: ${fail}, Skipped: ${skipped.length}`)
