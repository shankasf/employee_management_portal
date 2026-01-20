/**
 * Simple client-side cache for Supabase queries to improve navigation performance.
 * Uses a Map with TTL-based expiration and stale-while-revalidate pattern.
 *
 * PERFORMANCE: Includes automatic cache cleanup to prevent memory leaks
 */

import { getCacheTimings } from './cookiePreferences'

interface CacheEntry<T> {
  data: T
  timestamp: number
  promise?: Promise<T>
}

// PERFORMANCE: Maximum cache size to prevent memory leaks
const MAX_CACHE_SIZE = 100

// Global cache store
const cache = new Map<string, CacheEntry<unknown>>()

// PERFORMANCE: Track last cleanup time
let lastCleanupTime = 0
const CLEANUP_INTERVAL = 60 * 1000 // 1 minute

/**
 * Clean up expired cache entries to prevent memory leaks
 */
function cleanupCache(staleTTL: number): void {
  const now = Date.now()

  // Only cleanup periodically
  if (now - lastCleanupTime < CLEANUP_INTERVAL) return
  lastCleanupTime = now

  // Remove expired entries - convert to array first to avoid iterator issues
  const entries = Array.from(cache.entries())
  entries.forEach(([key, entry]) => {
    if (now - entry.timestamp > staleTTL) {
      cache.delete(key)
    }
  })

  // If still over limit, remove oldest entries
  if (cache.size > MAX_CACHE_SIZE) {
    const sortedEntries = Array.from(cache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp)

    const toRemove = sortedEntries.slice(0, sortedEntries.length - MAX_CACHE_SIZE)
    toRemove.forEach(([key]) => cache.delete(key))
  }
}

// Get TTL values from cookie preferences (supports fast mode when cookies accepted)
function getDefaultTTLs() {
  const timings = getCacheTimings()
  return {
    freshTTL: timings.freshTTL,
    staleTTL: timings.staleTTL,
  }
}

interface CacheOptions {
  freshTTL?: number  // Time data is considered fresh
  staleTTL?: number  // Time data can be used while revalidating
}

/**
 * Get cached data or fetch fresh data.
 * Returns cached data immediately if fresh, or returns stale data while revalidating in background.
 */
export async function cachedQuery<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: CacheOptions = {}
): Promise<T> {
  const defaults = getDefaultTTLs()
  const { freshTTL = defaults.freshTTL, staleTTL = defaults.staleTTL } = options
  const now = Date.now()

  // PERFORMANCE: Periodically cleanup expired entries
  cleanupCache(staleTTL)

  const entry = cache.get(key) as CacheEntry<T> | undefined

  // If we have fresh data, return it immediately
  if (entry && now - entry.timestamp < freshTTL) {
    return entry.data
  }

  // If we have stale data, return it but revalidate in background
  if (entry && now - entry.timestamp < staleTTL) {
    // Revalidate in background if not already doing so
    if (!entry.promise) {
      entry.promise = fetcher().then((data) => {
        cache.set(key, { data, timestamp: Date.now() })
        return data
      }).catch((err) => {
        console.error(`Cache revalidation failed for ${key}:`, err)
        // Keep stale data on error
        return entry.data
      }).finally(() => {
        const current = cache.get(key) as CacheEntry<T> | undefined
        if (current) {
          delete current.promise
        }
      })
    }
    return entry.data
  }

  // No valid cache, fetch fresh data
  const data = await fetcher()
  cache.set(key, { data, timestamp: now })
  return data
}

/**
 * Invalidate specific cache entries by key prefix.
 */
export function invalidateCache(keyPrefix?: string): void {
  if (!keyPrefix) {
    cache.clear()
    return
  }
  const keysToDelete: string[] = []
  cache.forEach((_, key) => {
    if (key.startsWith(keyPrefix)) {
      keysToDelete.push(key)
    }
  })
  keysToDelete.forEach(key => cache.delete(key))
}

/**
 * Invalidate cache for a specific key.
 */
export function invalidateCacheKey(key: string): void {
  cache.delete(key)
}

/**
 * Pre-populate cache with data (useful after mutations).
 */
export function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, timestamp: Date.now() })
}

// Cache keys constants for consistency
export const CACHE_KEYS = {
  ADMIN_STATS: 'admin:dashboard:stats',
  EMPLOYEES: 'admin:employees',
  ATTENDANCE: (date: string) => `admin:attendance:${date}`,
  EVENTS: 'admin:events',
  TASKS: 'admin:tasks',
  POLICIES: 'admin:policies',
  EMPLOYEE_DASHBOARD: (userId: string) => `employee:dashboard:${userId}`,
  EMPLOYEE_TASKS: (userId: string, date: string) => `employee:tasks:${userId}:${date}`,
  EMPLOYEE_EVENTS: (userId: string) => `employee:events:${userId}`,
  MY_NOTES: (userId: string) => `employee:notes:${userId}`,
} as const
