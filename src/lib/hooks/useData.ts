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

// Default SWR config optimized for our use case
const defaultConfig: SWRConfiguration = {
  revalidateOnFocus: true,      // Refetch when window regains focus
  revalidateOnReconnect: true,  // Refetch when network reconnects
  dedupingInterval: 5000,       // Dedupe requests within 5 seconds
  errorRetryCount: 3,           // Retry failed requests 3 times
  errorRetryInterval: 1000,     // Start with 1s retry interval
  focusThrottleInterval: 10000, // Throttle focus revalidation to every 10s
  onError: (error) => {
    handleAuthError(error)
  },
  onErrorRetry: (error, _key, _config, revalidate, { retryCount }) => {
    // Don't retry on auth errors - handle them differently
    if (isAuthError(error)) {
      handleAuthError(error)
      return
    }
    // Standard retry for other errors (max 3 times)
    if (retryCount >= 3) return
    setTimeout(() => revalidate({ retryCount }), 1000 * Math.pow(2, retryCount))
  },
}

// Longer cache for less frequently changing data
const longCacheConfig: SWRConfiguration = {
  ...defaultConfig,
  dedupingInterval: 30000,      // 30 seconds
  focusThrottleInterval: 60000, // 1 minute
}

// ============================================
// ADMIN HOOKS
// ============================================

/**
 * Fetch admin dashboard statistics
 */
export function useAdminStats() {
  return useSWR(
    'admin:dashboard:stats',
    async () => {
      const supabase = createUntypedClient()
      const { data, error } = await supabase.rpc('get_admin_dashboard_stats')
      
      if (error) {
        // Fallback to manual count
        const { count: empCount } = await supabase
          .from('employees')
          .select('*', { count: 'exact', head: true })
          .eq('is_active', true)
        
        return {
          active_employees: empCount || 0,
          clocked_in_today: 0,
          tasks_completed_today: 0,
          tasks_pending_today: 0,
          events_today: 0,
          events_this_week: 0,
        }
      }
      return data?.[0] || {}
    },
    { ...defaultConfig, refreshInterval: 30000 } // Auto-refresh every 30s
  )
}

/**
 * Fetch employees list with optional inactive filter
 */
export function useEmployees(showInactive = false) {
  return useSWR(
    ['admin:employees', showInactive],
    async () => {
      const supabase = createUntypedClient()
      let query = supabase
        .from('employees')
        .select(`
          *,
          profiles (
            email,
            full_name,
            role,
            status,
            email_confirmed_at
          )
        `)
        .order('display_name')

      if (!showInactive) {
        query = query.eq('is_active', true)
      }

      const { data, error } = await query
      if (error) throw error
      return data || []
    },
    defaultConfig
  )
}

/**
 * Fetch attendance logs for a specific date
 */
export function useAttendance(dateFilter: string) {
  return useSWR(
    ['admin:attendance', dateFilter],
    async () => {
      const supabase = createUntypedClient()
      const [year, month, day] = dateFilter.split('-').map(Number)
      const startOfDay = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0))
      const endOfDay = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999))

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

      if (error) throw error
      return data || []
    },
    defaultConfig
  )
}

/**
 * Fetch events with filter (upcoming, today, past)
 */
export function useEvents(filter: 'upcoming' | 'today' | 'past' = 'upcoming') {
  return useSWR(
    ['admin:events', filter],
    async () => {
      const supabase = createUntypedClient()
      const now = new Date()
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0)
      const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)

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
    defaultConfig
  )
}

/**
 * Fetch all tasks
 */
export function useTasks() {
  return useSWR(
    'admin:tasks',
    async () => {
      const supabase = createUntypedClient()
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .order('title')

      if (error) throw error
      return data || []
    },
    longCacheConfig
  )
}

/**
 * Fetch all policies
 */
export function usePolicies() {
  return useSWR(
    'admin:policies',
    async () => {
      const supabase = createUntypedClient()
      const { data, error } = await supabase
        .from('policy_strips')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error
      return data || []
    },
    longCacheConfig
  )
}

/**
 * Fetch active employees (for dropdowns/selects)
 */
export function useActiveEmployees() {
  return useSWR(
    'admin:employees:active',
    async () => {
      const supabase = createUntypedClient()
      const { data, error } = await supabase
        .from('employees')
        .select('id, display_name, position')
        .eq('is_active', true)
        .order('display_name')

      if (error) throw error
      return data || []
    },
    longCacheConfig
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
      const supabase = createUntypedClient()

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
    { ...defaultConfig, refreshInterval: 60000 } // Check every minute
  )
}

/**
 * Fetch employee's today tasks
 */
export function useTodayTasks(userId: string | undefined) {
  const today = new Date().toISOString().split('T')[0]

  return useSWR(
    userId ? ['employee:tasks', userId, today] : null,
    async () => {
      if (!userId) return []
      const supabase = createUntypedClient()

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
    defaultConfig
  )
}

/**
 * Fetch employee's upcoming events
 */
export function useMyUpcomingEvents(userId: string | undefined) {
  return useSWR(
    userId ? ['employee:events', userId] : null,
    async () => {
      if (!userId) return []
      const supabase = createUntypedClient()

      // Direct query (faster than RPC with fallback)
      const { data, error } = await supabase
        .from('event_staff_assignments')
        .select(`
          role,
          events (
            id,
            title,
            start_time,
            end_time,
            room
          )
        `)
        .eq('employee_id', userId)
        .limit(5)

      if (error) throw error

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data || [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((a: any) => a.events && new Date(a.events.start_time) >= new Date())
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((a: any) => ({
          id: a.events.id,
          title: a.events.title,
          start_time: a.events.start_time,
          end_time: a.events.end_time,
          room: a.events.room,
          my_role: a.role
        }))
    },
    defaultConfig
  )
}

/**
 * Fetch active policy strips
 */
export function useActivePolicies() {
  return useSWR(
    'employee:policies:active',
    async () => {
      const supabase = createUntypedClient()
      const { data, error } = await supabase
        .from('policy_strips')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(5)

      if (error) throw error
      return data || []
    },
    { ...longCacheConfig, refreshInterval: 300000 } // Refresh every 5 minutes
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
      const supabase = createUntypedClient()
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
        .order('created_at', { ascending: false })
        .limit(20)

      if (error) throw error
      return data || []
    },
    defaultConfig
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
  return useSWR(
    ['admin:schedules', filters],
    async () => {
      const supabase = createUntypedClient()
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

      const { data, error } = await query
      if (error) throw error
      return data || []
    },
    defaultConfig
  )
}

/**
 * Fetch employee's schedules
 */
export function useMySchedules(userId: string | undefined, filter: 'upcoming' | 'pending' | 'all' = 'upcoming') {
  const today = new Date().toISOString().split('T')[0]

  return useSWR(
    userId ? ['employee:schedules', userId, filter] : null,
    async () => {
      if (!userId) return []
      const supabase = createUntypedClient()

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

      const { data, error } = await query
      if (error) throw error
      return data || []
    },
    defaultConfig
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
      const supabase = createUntypedClient()

      const { count, error } = await supabase
        .from('schedules')
        .select('*', { count: 'exact', head: true })
        .eq('employee_id', userId)
        .eq('status', 'pending')

      if (error) throw error
      return count || 0
    },
    { ...defaultConfig, refreshInterval: 60000 } // Check every minute
  )
}

/**
 * Fetch schedule stats for admin dashboard
 */
export function useScheduleStats() {
  return useSWR(
    'admin:schedules:stats',
    async () => {
      const supabase = createUntypedClient()
      const today = new Date().toISOString().split('T')[0]

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

      return {
        pending: pendingResult.count || 0,
        cancellationRequested: cancelRequestResult.count || 0,
        todaySchedules: todayResult.count || 0,
      }
    },
    { ...defaultConfig, refreshInterval: 30000 }
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
