import nodemailer from 'nodemailer'
import { readFileSync } from 'fs'

// Load .env.local
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const fromEmail = process.env.SMTP_FROM || 'noreply@playfunia.com'
const fromName = process.env.SMTP_FROM_NAME || 'PlayFunia Employee Portal'
const to = process.argv[2] || 'sagar@callsphere.tech'

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
})

console.log('From header:', `"${fromName}" <${fromEmail}>`)

const info = await transporter.sendMail({
  from: `"${fromName}" <${fromEmail}>`,
  to,
  subject: 'Test: From-name verification',
  text: 'This is a test email to confirm the sender display name is correct.',
})

console.log('Sent to:', to)
console.log('Message ID:', info.messageId)
console.log('Response:', info.response)
