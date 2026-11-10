'use client'

import { usePathname } from 'next/navigation'

export const EMPLOYEE_ONBOARDING_BASE = '/employee/onboarding'
export const ADMIN_ONBOARDING_BASE = '/admin/my-onboarding'

/**
 * The onboarding pages are shared between the two portals: employees reach them
 * at /employee/onboarding/... and admins (who are also employees with their own
 * assigned training) reach the same components at /admin/my-onboarding/...
 *
 * Internal links must stay inside whichever portal the user is currently in,
 * otherwise an admin clicking a video would be thrown into the employee layout.
 */
export function useOnboardingBasePath(): string {
  const pathname = usePathname()
  return pathname?.startsWith('/admin') ? ADMIN_ONBOARDING_BASE : EMPLOYEE_ONBOARDING_BASE
}
