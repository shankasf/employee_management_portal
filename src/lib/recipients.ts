import { createServiceClient } from './supabase/server'

export interface EmployeeRecipient {
  id: string
  email: string | null
  phoneNumber: string | null
  fullName: string
  displayName: string | null
}

// Single source of truth for the "should this employee receive notifications"
// gate. Returns null when the employee is deactivated (employees.is_active=false)
// or their profile is inactive (profiles.status='inactive'). Notify routes
// call this before sending so the check lives in one place.
export async function getEmployeeRecipient(
  employeeId: string | null | undefined
): Promise<EmployeeRecipient | null> {
  if (!employeeId) return null

  const supabase = await createServiceClient()
  const { data, error } = await supabase
    .from('employees')
    .select('id, display_name, phone_number, is_active, profiles(email, full_name, status)')
    .eq('id', employeeId)
    .maybeSingle()

  if (error || !data) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const emp = data as any
  if (emp.is_active === false) return null
  if (emp.profiles?.status === 'inactive') return null

  return {
    id: emp.id,
    email: emp.profiles?.email ?? null,
    phoneNumber: emp.phone_number ?? null,
    fullName: emp.profiles?.full_name ?? emp.display_name ?? 'Employee',
    displayName: emp.display_name ?? null,
  }
}

export async function getEmployeeRecipients(
  employeeIds: string[]
): Promise<EmployeeRecipient[]> {
  const unique = Array.from(new Set(employeeIds.filter(Boolean)))
  if (unique.length === 0) return []

  const supabase = await createServiceClient()
  const { data, error } = await supabase
    .from('employees')
    .select('id, display_name, phone_number, is_active, profiles(email, full_name, status)')
    .in('id', unique)

  if (error || !data) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[])
    .filter((emp) => emp.is_active !== false && emp.profiles?.status !== 'inactive')
    .map((emp) => ({
      id: emp.id,
      email: emp.profiles?.email ?? null,
      phoneNumber: emp.phone_number ?? null,
      fullName: emp.profiles?.full_name ?? emp.display_name ?? 'Employee',
      displayName: emp.display_name ?? null,
    }))
}
