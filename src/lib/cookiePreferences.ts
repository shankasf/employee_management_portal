/**
 * Cookie preferences management for performance optimization.
 * When users accept cookies, we enable more aggressive caching for faster page reloads.
 *
 * PERFORMANCE: Caches the consent value in memory to avoid repeated localStorage reads
 */

const COOKIE_CONSENT_KEY = 'playfunia_cookie_consent'

export type CookieConsent = 'accepted' | 'declined' | null

// PERFORMANCE: Cache the consent value after first read
// localStorage.getItem() is synchronous and blocks the main thread
let cachedConsent: CookieConsent | undefined = undefined

/**
 * Get the current cookie consent status
 * PERFORMANCE: Returns cached value after first read
 */
export function getCookieConsent(): CookieConsent {
  if (typeof window === 'undefined') return null

  // Return cached value if available
  if (cachedConsent !== undefined) return cachedConsent

  // Read from localStorage only once
  const consent = localStorage.getItem(COOKIE_CONSENT_KEY)
  cachedConsent = (consent === 'accepted' || consent === 'declined') ? consent : null
  return cachedConsent
}

/**
 * Set cookie consent preference
 */
export function setCookieConsent(consent: 'accepted' | 'declined'): void {
  if (typeof window === 'undefined') return

  // Update both cache and localStorage
  cachedConsent = consent
  localStorage.setItem(COOKIE_CONSENT_KEY, consent)

  // Dispatch event so components can react to the change
  window.dispatchEvent(new CustomEvent('cookieConsentChanged', { detail: consent }))
}

/**
 * Check if user has accepted cookies (enables faster caching)
 */
export function hasFastCachingEnabled(): boolean {
  return getCookieConsent() === 'accepted'
}

/**
 * Check if user has made a cookie choice (to hide banner)
 */
export function hasConsentChoice(): boolean {
  return getCookieConsent() !== null
}

// Cache timing constants based on user preference
export const CACHE_TIMINGS = {
  // Standard timings (cookies not accepted)
  standard: {
    freshTTL: 30 * 1000,        // 30 seconds
    staleTTL: 5 * 60 * 1000,    // 5 minutes
    dedupingInterval: 30000,    // 30 seconds
    focusThrottleInterval: 60000, // 1 minute
    refreshInterval: 120000,    // 2 minutes
  },
  // Fast timings (cookies accepted)
  fast: {
    freshTTL: 2 * 60 * 1000,    // 2 minutes
    staleTTL: 15 * 60 * 1000,   // 15 minutes
    dedupingInterval: 60000,    // 1 minute
    focusThrottleInterval: 300000, // 5 minutes
    refreshInterval: 300000,    // 5 minutes
  },
} as const

/**
 * Get cache timings based on cookie consent
 */
export function getCacheTimings() {
  return hasFastCachingEnabled() ? CACHE_TIMINGS.fast : CACHE_TIMINGS.standard
}
