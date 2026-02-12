/**
 * SWR-based data fetching hooks for optimized database queries.
 *
 * Benefits of SWR:
 * - Automatic caching and revalidation
 * - Request deduplication (multiple components using same hook share one request)
 * - Focus revalidation (refetch when user returns to tab)
 * - Stale-while-revalidate pattern (show cached data immediately, update in background)
 * - Error retry with exponential backoff
 * - Optimistic UI support
 */

import useSWR, { SWRConfiguration, mutate } from 'swr'
import { createUntypedClient, isAuthError, refreshSession } from '@/lib/supabase/client'
import { getCacheTimings } from '@/lib/cookiePreferences'
import { useAuth } from '@/contexts/AuthContext'
import { NY_TIMEZONE } from '@/lib/utils'

// PERFORMANCE: Only log in development
const isDev = process.env.NODE_ENV === 'development';

// Client-side logging helper for data hooks (disabled in production)
const log = (hook: string, message: string, data?: Record<string, unknown>) => {
  if (!isDev || typeof window === 'undefined') return;
  const ts = new Date().toISOString().split('T')[1].slice(0, 12);
  const dataStr = data ? ` | ${JSON.stringify(data)}` : '';
  console.log(`%c[${ts}] [Data:${hook}] ${message}${dataStr}`, 'color: #2196F3');
};

// Uses the same underlying client as AuthContext (shared singleton)
const supabase = createUntypedClient()

// PERFORMANCE: Removed module-level getSession call - it was causing unnecessary
// auth checks on every import. Session is already checked by AuthContext.

// PERFORMANCE: Cache today's date string to avoid recreation on every render
// Refreshes when day changes (checked every minute via SWR's built-in intervals)
// Uses New York timezone for consistent date handling
let cachedToday: string = ''
let cachedTodayTimestamp = 0

function getTodayString(): string {
  const now = Date.now()
  // Refresh cache if more than 60 seconds old (catches day changes)
  if (now - cachedTodayTimestamp > 60000) {
    // Use New York timezone for consistent date across the app
    const nyDate = new Date(new Date().toLocaleString("en-US", { timeZone: NY_TIMEZONE }))
    const year = nyDate.getFullYear()
    const month = String(nyDate.getMonth() + 1).padStart(2, '0')
    const day = String(nyDate.getDate()).padStart(2, '0')
    cachedToday = `${year}-${month}-${day}`
    cachedTodayTimestamp = now
  }
  return cachedToday
}

/**
 * Hook to get auth-gated SWR key
 * Returns null if not authenticated, preventing SWR from fetching
 *
 * IMPORTANT: We check user first, not isLoading. This allows data fetching
 * to start as soon as user is available (from onAuthStateChange), even if
 * profile is still loading. This prevents the "zeros on refresh" issue.
 */
export function useAuthGatedKey<T>(key: T): T | null {
  const { user, isLoading } = useAuth()
  const keyStr = typeof key === 'string' ? key : JSON.stringify(key);

  // If we have a user, allow fetching even if profile is still loading
  if (user) {
    log('useAuthGatedKey', `${keyStr} -> ACTIVE`, { userId: user.id });
    return key;
  }

  // If still loading and no user yet, wait
  if (isLoading) {
    log('useAuthGatedKey', `${keyStr} -> null (loading, no user yet)`, { isLoading });
    return null;
  }

  // Not loading and no user = not authenticated
  log('useAuthGatedKey', `${keyStr} -> null (not authenticated)`);
  return null
}

// Track if we're currently handling an auth error (prevent infinite loops)
let isHandlingAuthError = false

// Global error handler for auth errors
const handleAuthError = async (error: unknown): Promise<void> => {
  if (!isAuthError(error) || isHandlingAuthError) return

  isHandlingAuthError = true

  try {
    // Try to refresh the session
    const refreshed = await refreshSession()

    if (refreshed) {
      // Session refreshed successfully, revalidate all data
      await mutate(() => true, undefined, { revalidate: true })
    } else {
      // Refresh failed, redirect to login
      console.warn('Session expired, redirecting to login...')
      if (typeof window !== 'undefined') {
        // Clear any stale auth data
        window.localStorage.removeItem('supabase.auth.token')
        window.location.href = '/login?expired=true'
      }
    }
  } finally {
    // Reset after a short delay to prevent rapid retries
    setTimeout(() => {
      isHandlingAuthError = false
    }, 2000)
  }
}

// PERFORMANCE: Shallow comparison for SWR - faster than JSON.stringify
function shallowCompare(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return a === b
  if (typeof a !== 'object') return a === b

  // For arrays, compare length and each element's top-level properties
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    if (a.length === 0) return true
    for (let i = 0; i < a.length; i++) {
      if (!shallowEqualObjects(a[i], b[i])) return false
    }
    return true
  }

  return shallowEqualObjects(a, b)
}

function shallowEqualObjects(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return a === b
  const aObj = a as Record<string, unknown>
  const bObj = b as Record<string, unknown>
  const aKeys = Object.keys(aObj)
  const bKeys = Object.keys(bObj)
  if (aKeys.length !== bKeys.length) return false
  for (const key of aKeys) {
    if (aObj[key] !== bObj[key]) return false
  }
  return true
}

// Get SWR config based on cookie preferences (fast mode when accepted)
function getDefaultConfig(): SWRConfiguration {
  const timings = getCacheTimings()
  return {
    revalidateOnFocus: false,     // Disabled - prevents refetch on every tab switch
    revalidateOnReconnect: false, // Disabled - prevents cascade on network changes
    revalidateIfStale: false,     // PERFORMANCE: Don't auto-revalidate stale data
    keepPreviousData: true,       // PERFORMANCE: Show stale data while fetching new
    dedupingInterval: timings.dedupingInterval,
    errorRetryCount: 2,           // Retry failed requests 2 times
    errorRetryInterval: 2000,     // Start with 2s retry interval
    focusThrottleInterval: timings.focusThrottleInterval,
    compare: shallowCompare,      // PERFORMANCE: Shallow compare (faster than JSON.stringify)
    onSuccess: (data, key) => {
      log('SWR:onSuccess', `Key: ${typeof key === 'string' ? key : JSON.stringify(key)}`, { hasData: !!data });
    },
    onError: (error, key) => {
      log('SWR:onError', `Key: ${typeof key === 'string' ? key : JSON.stringify(key)}`, { error: error?.message || String(error) });
      handleAuthError(error)
    },
    onErrorRetry: (error, _key, _config, revalidate, { retryCount }) => {
      log('SWR:onErrorRetry', `Retry ${retryCount}`, { error: error?.message || String(error) });
      // Don't retry on auth errors - handle them differently
      if (isAuthError(error)) {
        handleAuthError(error)
        return
      }
      // Standard retry for other errors (max 2 times)
      if (retryCount >= 2) return
      setTimeout(() => revalidate({ retryCount }), 2000 * Math.pow(2, retryCount))
    },
  }
}

// Longer cache for less frequently changing data
function getLongCacheConfig(): SWRConfiguration {
  const timings = getCacheTimings()
  return {
    ...getDefaultConfig(),
    dedupingInterval: timings.dedupingInterval * 2,
    focusThrottleInterval: timings.focusThrottleInterval * 2,
  }
}

/**
 * PERFORMANCE: ensureSession removed - it was redundant
 * The auth-gated key (useAuthGatedKey) already prevents fetching when not authenticated.
 * AuthContext handles session validation and refresh.
 * Keeping this as a no-op for backward compatibility.
 */
async function ensureSession(): Promise<boolean> {
  // PERFORMANCE: No longer checks session - AuthContext handles this
  // The auth-gated key prevents queries when user is not authenticated
  return true;
}

// ============================================
// ADMIN HOOKS
// ============================================

/**
 * Fetch admin dashboard statistics
 * Uses auth-gated key - won't fetch until user is authenticated
 */
export function useAdminStats() {
  const key = useAuthGatedKey('admin:dashboard:stats')
  log('useAdminStats', 'Hook called', { key });

  return useSWR(
    key,
    async () => {
      log('useAdminStats', 'Fetcher START');

      // Ensure we have a valid session before querying
      const hasSession = await ensureSession();
      if (!hasSession) {
        log('useAdminStats', 'No session, returning defaults');
        return {
          active_employees: 0,
          clocked_in_today: 0,
          tasks_completed_today: 0,
          tasks_pending_today: 0,
          events_today: 0,
          events_this_week: 0,
        };
      }

      const { data, error } = await supabase.rpc('get_admin_dashboard_stats')

      if (error) {
        log('useAdminStats', 'RPC error, using fallback', { error: error.message, code: error.code });
        // Fallback to manual count
        const { count: empCount } = await supabase
          .from('employees')
          .select('*', { count: 'exact', head: true })
          .eq('is_active', true)

        const fallbackData = {
          active_employees: empCount || 0,
          clocked_in_today: 0,
          tasks_completed_today: 0,
          tasks_pending_today: 0,
          events_today: 0,
          events_this_week: 0,
        };
        log('useAdminStats', 'Fallback data', fallbackData);
        return fallbackData;
      }
      const result = data?.[0] || {};
      log('useAdminStats', 'RPC success', result);
      return result;
    },
    { ...getDefaultConfig(), refreshInterval: getCacheTimings().refreshInterval }
  )
}

/**
 * Fetch employees list with optional inactive filter
 */
export function useEmployees(showInactive = false) {
  const key = useAuthGatedKey(['admin:employees', showInactive])
  log('useEmployees', 'Hook called', { key, showInactive });

  return useSWR(
    key,
    async () => {
      log('useEmployees', 'Fetcher START');

      // Ensure we have a valid session before querying
      const hasSession = await ensureSession();
      if (!hasSession) {
        log('useEmployees', 'No session, returning empty');
        return [];
      }

      let query = supabase
        .from('employees')
        .select(`
          *,
          profiles (
            email,
            full_name,
            role,
            status
          )
        `)
        .order('display_name')

      if (!showInactive) {
        query = query.eq('is_active', true)
      }

      // PERFORMANCE: Add limit to prevent unbounded queries
      const { data, error } = await query.limit(500)
      if (error) {
        log('useEmployees', 'Query error', { error: error.message, code: error.code });
        throw error;
      }
      log('useEmployees', 'Query success', { count: data?.length || 0 });
      return data || []
    },
    getDefaultConfig()
  )
}

/**
 * Fetch attendance logs for a specific date
 */
export function useAttendance(dateFilter: string) {
  const key = useAuthGatedKey(['admin:attendance', dateFilter])

  return useSWR(
    key,
    async () => {
      // Use NY timezone offset to create correct day boundaries
      // Determine NY offset using Intl API (works regardless of browser timezone)
      const getNYOffset = (dateStr: string) => {
        const dt = new Date(`${dateStr}T12:00:00Z`) // noon UTC to avoid edge cases
        const nyStr = dt.toLocaleString('en-US', { timeZone: NY_TIMEZONE, hour12: false, hour: '2-digit', minute: '2-digit' })
        const utcStr = dt.toLocaleString('en-US', { timeZone: 'UTC', hour12: false, hour: '2-digit', minute: '2-digit' })
        const [nyH, nyM] = nyStr.split(':').map(Number)
        const [utcH, utcM] = utcStr.split(':').map(Number)
        const diffMinutes = (nyH * 60 + nyM) - (utcH * 60 + utcM)
        const offsetHours = Math.round(diffMinutes / 60)
        return offsetHours // -5 for EST, -4 for EDT
      }
      const nyOffset = getNYOffset(dateFilter)
      const offsetStr = `${nyOffset < 0 ? '-' : '+'}${String(Math.abs(nyOffset)).padStart(2, '0')}:00`
      const startOfDay = new Date(`${dateFilter}T00:00:00${offsetStr}`)
      const endOfDay = new Date(`${dateFilter}T23:59:59.999${offsetStr}`)

      const { data, error } = await supabase
        .from('attendance_logs')
        .select(`
          *,
          employees (
            id,
            display_name,
            position
          )
        `)
        .gte('clock_in', startOfDay.toISOString())
        .lte('clock_in', endOfDay.toISOString())
        .order('clock_in', { ascending: false })
        .limit(500)  // PERFORMANCE: Limit attendance records per day

      if (error) throw error
      return data || []
    },
    getDefaultConfig()
  )
}

/**
 * Fetch events with filter (upcoming, today, past)
 */
export function useEvents(filter: 'upcoming' | 'today' | 'past' = 'upcoming') {
  const key = useAuthGatedKey(['admin:events', filter])

  return useSWR(
    key,
    async () => {
      // Use NY timezone for consistent "today" boundaries
      // Get today's date string in NY timezone
      const nyDateStr = new Date().toLocaleDateString("en-CA", { timeZone: NY_TIMEZONE }) // YYYY-MM-DD format
      // Get the NY offset for today using Intl API
      const nowUtc = new Date(`${nyDateStr}T12:00:00Z`)
      const nyTimeStr = nowUtc.toLocaleString('en-US', { timeZone: NY_TIMEZONE, hour12: false, hour: '2-digit', minute: '2-digit' })
      const utcTimeStr = nowUtc.toLocaleString('en-US', { timeZone: 'UTC', hour12: false, hour: '2-digit', minute: '2-digit' })
      const [nyH, nyMin] = nyTimeStr.split(':').map(Number)
      const [utcH] = utcTimeStr.split(':').map(Number)
      const nyOffsetHours = Math.round(((nyH * 60 + nyMin) - (utcH * 60 + 0)) / 60)
      const offsetStr = `${nyOffsetHours < 0 ? '-' : '+'}${String(Math.abs(nyOffsetHours)).padStart(2, '0')}:00`
      const todayStart = new Date(`${nyDateStr}T00:00:00${offsetStr}`)
      const todayEnd = new Date(`${nyDateStr}T23:59:59${offsetStr}`)

      let query = supabase
        .from('events')
        .select(`
          *,
          event_staff_assignments (
            id,
            role,
            employees (
              id,
              display_name
            )
          )
        `)
        .order('start_time', { ascending: filter !== 'past' })

      if (filter === 'upcoming') {
        query = query.gte('start_time', new Date().toISOString())
      } else if (filter === 'today') {
        query = query
          .gte('start_time', todayStart.toISOString())
          .lte('start_time', todayEnd.toISOString())
      } else {
        query = query.lt('start_time', new Date().toISOString())
      }

      const { data, error } = await query.limit(50)
      if (error) throw error
      return data || []
    },
    getDefaultConfig()
  )
}

/**
 * Fetch all tasks
 */
export function useTasks() {
  const key = useAuthGatedKey('admin:tasks')

  return useSWR(
    key,
    async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .order('title')
        .limit(100) // Prevent unbounded queries

      if (error) throw error
      return data || []
    },
    getLongCacheConfig()
  )
}

/**
 * Fetch all task instances (assigned tasks) for admin view
 */
export function useTaskInstances(filters?: {
  startDate?: string
  endDate?: string
  status?: string
  employeeId?: string
}) {
  const key = useAuthGatedKey(['admin:task-instances', filters])

  return useSWR(
    key,
    async () => {
      // Use API route to bypass RLS issues
      const params = new URLSearchParams()
      if (filters?.startDate) params.set('startDate', filters.startDate)
      if (filters?.endDate) params.set('endDate', filters.endDate)
      if (filters?.status) params.set('status', filters.status)
      if (filters?.employeeId) params.set('employeeId', filters.employeeId)

      const response = await fetch(`/api/admin/task-instances?${params.toString()}`)
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to fetch task instances')
      }

      const { data } = await response.json()
      return data || []
    },
    getDefaultConfig()
  )
}

/**
 * Fetch all policies
 */
export function usePolicies() {
  const key = useAuthGatedKey('admin:policies')

  return useSWR(
    key,
    async () => {
      const { data, error } = await supabase
        .from('policy_strips')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50) // Prevent unbounded queries

      if (error) throw error
      return data || []
    },
    getLongCacheConfig()
  )
}

/**
 * Fetch active employees (for dropdowns/selects)
 */
export function useActiveEmployees() {
  const key = useAuthGatedKey('admin:employees:active')

  return useSWR(
    key,
    async () => {
      const { data, error } = await supabase
        .from('employees')
        .select('id, display_name, position')
        .eq('is_active', true)
        .order('display_name')
        .limit(200) // Prevent unbounded queries

      if (error) throw error
      return data || []
    },
    getLongCacheConfig()
  )
}

// ============================================
// EMPLOYEE HOOKS
// ============================================

/**
 * Fetch employee's open attendance (clocked in status)
 */
export function useOpenAttendance(userId: string | undefined) {
  return useSWR(
    userId ? ['employee:attendance:open', userId] : null,
    async () => {
      if (!userId) return null
      
      // Direct query (faster than RPC with fallback)
      const { data, error } = await supabase
        .from('attendance_logs')
        .select('id, clock_in')
        .eq('employee_id', userId)
        .is('clock_out', null)
        .order('clock_in', { ascending: false })
        .limit(1)

      if (error) throw error
      return data?.[0] || null
    },
    { ...getDefaultConfig(), refreshInterval: getCacheTimings().refreshInterval } // Check every 2 minutes
  )
}

/**
 * Fetch employee's today tasks
 * PERFORMANCE: Uses cached today string to avoid key changes on re-render
 */
export function useTodayTasks(userId: string | undefined) {
  const today = getTodayString()

  return useSWR(
    userId ? ['employee:tasks', userId, today] : null,
    async () => {
      if (!userId) return []
      
      // Direct query (faster than RPC with fallback)
      const { data, error } = await supabase
        .from('task_instances')
        .select(`
          id,
          task_id,
          status,
          tasks (
            title,
            description,
            location,
            cutoff_time,
            requires_photo,
            requires_video,
            requires_notes
          )
        `)
        .eq('employee_id', userId)
        .eq('scheduled_date', today)
        .limit(10)

      if (error) throw error

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data || []).map((t: any) => ({
        id: t.id,
        task_id: t.task_id,
        title: t.tasks?.title || 'Unknown Task',
        description: t.tasks?.description || null,
        location: t.tasks?.location || null,
        status: t.status,
        cutoff_time: t.tasks?.cutoff_time || null,
        requires_photo: t.tasks?.requires_photo || false,
        requires_video: t.tasks?.requires_video || false,
        requires_notes: t.tasks?.requires_notes || false,
      }))
    },
    getDefaultConfig()
  )
}

/**
 * Fetch employee's upcoming events
 * PERFORMANCE: Filter by date in database, not client-side
 */
export function useMyUpcomingEvents(userId: string | undefined) {
  return useSWR(
    userId ? ['employee:events', userId] : null,
    async () => {
      if (!userId) return []

      // PERFORMANCE: Get current timestamp once, filter in DB
      const now = new Date().toISOString()

      // Direct query with server-side date filter
      const { data, error } = await supabase
        .from('event_staff_assignments')
        .select(`
          role,
          events!inner (
            id,
            title,
            start_time,
            end_time,
            room
          )
        `)
        .eq('employee_id', userId)
        .gte('events.start_time', now)  // PERFORMANCE: Filter in DB, not client
        .order('events(start_time)', { ascending: true })
        .limit(5)

      if (error) throw error

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data || []).map((a: any) => ({
        id: a.events.id,
        title: a.events.title,
        start_time: a.events.start_time,
        end_time: a.events.end_time,
        room: a.events.room,
        my_role: a.role
      }))
    },
    getDefaultConfig()
  )
}

/**
 * Fetch active policy strips
 */
export function useActivePolicies() {
  const key = useAuthGatedKey('employee:policies:active')
  return useSWR(
    key,
    async () => {
            const { data, error } = await supabase
        .from('policy_strips')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(5)

      if (error) throw error
      return data || []
    },
    { ...getLongCacheConfig(), refreshInterval: getCacheTimings().refreshInterval * 2.5 } // Refresh every 5 minutes
  )
}

/**
 * Fetch employee's staff notes
 */
export function useMyNotes(userId: string | undefined) {
  return useSWR(
    userId ? ['employee:notes', userId] : null,
    async () => {
      if (!userId) return []
            const { data, error } = await supabase
        .from('staff_notes')
        .select(`
          id,
          note,
          created_at,
          events (
            title
          )
        `)
        .eq('employee_id', userId)
        .order('created_at', { ascending: false })
        .limit(20)

      if (error) throw error
      return data || []
    },
    getDefaultConfig()
  )
}

// ============================================
// COMBINED DASHBOARD HOOKS (PERFORMANCE OPTIMIZED)
// ============================================

/**
 * PERFORMANCE: Fetch all employee dashboard data in a single RPC call
 * Requires running the 002_performance_rpcs.sql migration first
 *
 * This hook fetches:
 * - Open attendance (clocked in status)
 * - Today's tasks
 * - Upcoming events
 * - Active policies
 * - Device info
 *
 * Usage: const { data } = useEmployeeDashboard(userId)
 * Then access data.open_attendance, data.today_tasks, etc.
 */
export function useEmployeeDashboard(userId: string | undefined) {
  return useSWR(
    userId ? ['employee:dashboard:combined', userId] : null,
    async () => {
      if (!userId) return null

      const { data, error } = await supabase.rpc('get_employee_dashboard_data', {
        p_user_id: userId
      })

      if (error) {
        // Return null for any RPC error to trigger fallback to individual hooks
        // Common errors: 42883 (function not found), 42803 (GROUP BY error), etc.
        console.warn('get_employee_dashboard_data RPC error:', error.code, error.message)
        return null
      }

      return data
    },
    { ...getDefaultConfig(), refreshInterval: getCacheTimings().refreshInterval }
  )
}

/**
 * PERFORMANCE: Fetch admin schedules page data in a single RPC call
 * Requires running the 002_performance_rpcs.sql migration first
 *
 * Returns schedules, employees list, and stats in one query
 */
export function useAdminSchedulesPageData(
  startDate: string,
  endDate: string,
  status?: string
) {
  const key = useAuthGatedKey(['admin:schedules:page', startDate, endDate, status])

  return useSWR(
    key,
    async () => {
      const { data, error } = await supabase.rpc('get_admin_schedules_page_data', {
        p_start_date: startDate,
        p_end_date: endDate,
        p_status: status || null
      })

      if (error) {
        // If RPC doesn't exist yet, return null to trigger fallback
        if (error.code === '42883') {
          console.warn('get_admin_schedules_page_data RPC not found. Run migration 002_performance_rpcs.sql')
          return null
        }
        throw error
      }

      return data
    },
    getDefaultConfig()
  )
}

// ============================================
// SCHEDULE HOOKS
// ============================================

/**
 * Fetch all schedules (admin view)
 */
export function useSchedules(filters?: {
  startDate?: string
  endDate?: string
  status?: string
  employeeId?: string
}) {
  const key = useAuthGatedKey(['admin:schedules', filters])

  return useSWR(
    key,
    async () => {
      let query = supabase
        .from('schedules')
        .select(`
          *,
          employee:employees (
            id,
            display_name,
            position,
            profiles (
              email,
              full_name
            )
          )
        `)
        .order('schedule_date', { ascending: true })
        .order('start_time', { ascending: true })

      if (filters?.startDate) {
        query = query.gte('schedule_date', filters.startDate)
      }
      if (filters?.endDate) {
        query = query.lte('schedule_date', filters.endDate)
      }
      if (filters?.status && filters.status !== 'all') {
        query = query.eq('status', filters.status)
      }
      if (filters?.employeeId) {
        query = query.eq('employee_id', filters.employeeId)
      }

      // PERFORMANCE: Add limit to prevent unbounded queries
      const { data, error } = await query.limit(500)
      if (error) throw error
      return data || []
    },
    getDefaultConfig()
  )
}

/**
 * Fetch employee's schedules
 * PERFORMANCE: Uses cached today string to avoid key changes on re-render
 */
export function useMySchedules(userId: string | undefined, filter: 'upcoming' | 'pending' | 'all' = 'upcoming') {
  const today = getTodayString()

  return useSWR(
    userId ? ['employee:schedules', userId, filter, today] : null,
    async () => {
      if (!userId) return []
      
      let query = supabase
        .from('schedules')
        .select('*')
        .eq('employee_id', userId)
        .order('schedule_date', { ascending: true })
        .order('start_time', { ascending: true })

      if (filter === 'upcoming') {
        query = query.gte('schedule_date', today).neq('status', 'cancelled')
      } else if (filter === 'pending') {
        query = query.eq('status', 'pending')
      }

      // PERFORMANCE: Add limit to prevent unbounded queries
      const { data, error } = await query.limit(100)
      if (error) throw error
      return data || []
    },
    getDefaultConfig()
  )
}

/**
 * Fetch pending schedule confirmations count (for badges)
 */
export function usePendingSchedulesCount(userId: string | undefined) {
  return useSWR(
    userId ? ['employee:schedules:pending:count', userId] : null,
    async () => {
      if (!userId) return 0
      
      const { count, error } = await supabase
        .from('schedules')
        .select('*', { count: 'exact', head: true })
        .eq('employee_id', userId)
        .eq('status', 'pending')

      if (error) throw error
      return count || 0
    },
    { ...getDefaultConfig(), refreshInterval: getCacheTimings().refreshInterval } // Check every 2 minutes
  )
}

/**
 * Fetch schedule stats for admin dashboard
 */
export function useScheduleStats() {
  const key = useAuthGatedKey('admin:schedules:stats')
  log('useScheduleStats', 'Hook called', { key });

  return useSWR(
    key,
    async () => {
      log('useScheduleStats', 'Fetcher START');
      const today = getTodayString()

      const [pendingResult, cancelRequestResult, todayResult] = await Promise.all([
        supabase
          .from('schedules')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'pending'),
        supabase
          .from('schedules')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'cancellation_requested'),
        supabase
          .from('schedules')
          .select('*', { count: 'exact', head: true })
          .eq('schedule_date', today)
          .neq('status', 'cancelled'),
      ])

      const result = {
        pending: pendingResult.count || 0,
        cancellationRequested: cancelRequestResult.count || 0,
        todaySchedules: todayResult.count || 0,
      };
      log('useScheduleStats', 'Query success', result);
      return result;
    },
    { ...getDefaultConfig(), refreshInterval: getCacheTimings().refreshInterval }
  )
}

// ============================================
// CACHE INVALIDATION HELPERS
// ============================================

/**
 * Invalidate and refetch specific cache keys
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export const invalidateQueries = {
  adminStats: () => mutate('admin:dashboard:stats'),
  employees: () => mutate((key: any) => {
    if (typeof key === 'string') return key.startsWith('admin:employees')
    if (Array.isArray(key)) return key[0]?.startsWith?.('admin:employees')
    return false
  }, undefined, { revalidate: true }),
  attendance: (date?: string) => date
    ? mutate(['admin:attendance', date])
    : mutate((key: any) => Array.isArray(key) && key[0] === 'admin:attendance', undefined, { revalidate: true }),
  events: () => mutate((key: any) => Array.isArray(key) && key[0] === 'admin:events', undefined, { revalidate: true }),
  tasks: () => mutate('admin:tasks'),
  policies: () => mutate((key: any) => {
    if (typeof key === 'string') return key.startsWith('admin:policies') || key.startsWith('employee:policies')
    return false
  }, undefined, { revalidate: true }),
  schedules: () => mutate((key: any) => {
    if (typeof key === 'string') return key.startsWith('admin:schedules')
    if (Array.isArray(key)) return key[0]?.startsWith?.('admin:schedules') || key[0] === 'employee:schedules'
    return false
  }, undefined, { revalidate: true }),
  scheduleStats: () => mutate('admin:schedules:stats'),
  myNotes: (userId: string) => mutate(['employee:notes', userId]),
  openAttendance: (userId: string) => mutate(['employee:attendance:open', userId]),
  todayTasks: (userId: string) => mutate((key: any) => Array.isArray(key) && key[0] === 'employee:tasks' && key[1] === userId, undefined, { revalidate: true }),
  mySchedules: (userId: string) => mutate((key: any) => Array.isArray(key) && key[0] === 'employee:schedules' && key[1] === userId, undefined, { revalidate: true }),
  pendingSchedulesCount: (userId: string) => mutate(['employee:schedules:pending:count', userId]),
  all: () => mutate(() => true, undefined, { revalidate: true }),
}
/* eslint-enable @typescript-eslint/no-explicit-any */
