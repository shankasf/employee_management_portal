import crypto from 'crypto'

/**
 * AES-256-GCM encryption for OAuth tokens at rest.
 *
 * A stolen database dump should not hand over live access to every employee's
 * Google account, so refresh tokens are never stored in plaintext.
 *
 * CALENDAR_TOKEN_ENC_KEY must be 32 bytes, supplied as 64 hex chars or base64.
 * Generate one with:  openssl rand -hex 32
 */

const ALGO = 'aes-256-gcm'
const IV_BYTES = 12
const TAG_BYTES = 16

let cachedKey: Buffer | null = null

function getKey(): Buffer {
  if (cachedKey) return cachedKey

  const raw = process.env.CALENDAR_TOKEN_ENC_KEY
  if (!raw) {
    throw new Error('CALENDAR_TOKEN_ENC_KEY is not set — calendar tokens cannot be stored securely')
  }

  let key: Buffer
  if (/^[0-9a-fA-F]{64}$/.test(raw.trim())) {
    key = Buffer.from(raw.trim(), 'hex')
  } else {
    key = Buffer.from(raw.trim(), 'base64')
  }

  if (key.length !== 32) {
    throw new Error('CALENDAR_TOKEN_ENC_KEY must decode to exactly 32 bytes')
  }

  cachedKey = key
  return key
}

/** True when a usable encryption key is configured. */
export function hasEncryptionKey(): boolean {
  try {
    getKey()
    return true
  } catch {
    return false
  }
}

/** Encrypt a token. Returns base64 of iv|tag|ciphertext, or null for empty input. */
export function encryptToken(plain: string | null | undefined): string | null {
  if (!plain) return null
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ciphertext]).toString('base64')
}

/** Decrypt a token produced by encryptToken. Returns null if absent or corrupt. */
export function decryptToken(payload: string | null | undefined): string | null {
  if (!payload) return null
  try {
    const buf = Buffer.from(payload, 'base64')
    if (buf.length <= IV_BYTES + TAG_BYTES) return null
    const iv = buf.subarray(0, IV_BYTES)
    const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
    const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES)
    const decipher = crypto.createDecipheriv(ALGO, getKey(), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch {
    // Wrong key or tampered payload — treat as no token so the caller re-auths.
    return null
  }
}

/** Generate a URL-safe secret (ICS feed tokens, OAuth state, watch secrets). */
export function generateSecret(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url')
}

/** Hash a feed token for storage. Lookup is by hash, never by raw value. */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/** Constant-time string comparison for secrets. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

/** Stable hash of an outbound event payload, so unchanged items skip the API. */
export function contentHash(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32)
}
