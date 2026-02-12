import { createClient, createUntypedClient } from "@/lib/supabase/client";
import { Updatable, IdDocumentType } from "@/types/supabase";
import { getTodayNY } from "@/lib/utils";

// Get all employees with profiles
export async function getEmployees(includeInactive = false) {
  const supabase = createClient();
  let query = supabase
    .from("employees")
    .select(
      `
      *,
      profiles (
        id,
        email,
        full_name,
        role,
        status
      )
    `
    )
    .order("display_name");

  if (!includeInactive) {
    query = query.eq("is_active", true);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// Get a single employee with profile
export async function getEmployee(id: string) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("employees")
    .select(
      `
      *,
      profiles (
        id,
        email,
        full_name,
        role,
        status
      )
    `
    )
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
}

// Update employee
export async function updateEmployee(
  id: string,
  updates: Updatable<"employees">
) {
  const supabase = createUntypedClient();
  const { data, error } = await supabase
    .from("employees")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Update profile
export async function updateProfile(
  id: string,
  updates: Updatable<"profiles">
) {
  const supabase = createUntypedClient();
  const { data, error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Get active employee count
export async function getActiveEmployeeCount() {
  const supabase = createClient();
  const { count, error } = await supabase
    .from("employees")
    .select("*", { count: "exact", head: true })
    .eq("is_active", true);

  if (error) throw error;
  return count || 0;
}

// Get employees clocked in today
export async function getClockedInToday() {
  const supabase = createClient();
  const today = getTodayNY();

  // Get proper NY offset for today to create accurate UTC boundary
  const noon = new Date(`${today}T12:00:00Z`)
  const nyH = parseInt(noon.toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit' }))
  const utcH = parseInt(noon.toLocaleString('en-US', { timeZone: 'UTC', hour12: false, hour: '2-digit' }))
  const offset = nyH - utcH
  const offsetStr = `${offset < 0 ? '-' : '+'}${String(Math.abs(offset)).padStart(2, '0')}:00`
  const startOfDay = new Date(`${today}T00:00:00${offsetStr}`).toISOString()

  const { data, error } = await supabase
    .from("attendance_logs")
    .select(
      `
      employee_id,
      clock_in,
      employees (
        id,
        display_name,
        position
      )
    `
    )
    .gte("clock_in", startOfDay)
    .is("clock_out", null);

  if (error) throw error;
  return data;
}

// Employee data interface for creation
export interface CreateEmployeeData {
  // Basic info
  display_name: string;
  position?: string;
  shift_type?: string;
  // Shift details
  shift_start?: string;
  shift_end?: string;
  // Company/Location
  company_name?: string;
  work_location?: string;
  // Personal details
  date_of_birth?: string;
  phone_number?: string;
  // Full address
  street_address?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  country?: string;
  // ID Documents
  id_document_type?: IdDocumentType;
  id_document_number?: string;
  id_document_expiry?: string;
  id_document_url?: string;
  // Emergency contact
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  // HR notes
  hr_notes?: string;
}

// Create new employee (admin only, requires service role)
export async function createEmployee(
  email: string,
  password: string,
  profileData: {
    full_name: string;
    role: "admin" | "employee";
  },
  employeeData: CreateEmployeeData
) {
  // Note: This requires service role client
  // In production, this should be handled by a server action or API route
  const supabase = createUntypedClient();

  // Create auth user
  const { data: authData, error: authError } =
    await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

  if (authError) throw authError;
  if (!authData.user) throw new Error("Failed to create user");

  const userId = authData.user.id;

  // Create profile
  const { error: profileError } = await supabase.from("profiles").insert({
    id: userId,
    email,
    ...profileData,
  });

  if (profileError) {
    // Clean up: delete auth user on profile creation failure
    await supabase.auth.admin.deleteUser(userId);
    throw profileError;
  }

  // Create employee record with all fields
  const { data: employee, error: employeeError } = await supabase
    .from("employees")
    .insert({
      id: userId,
      ...employeeData,
    })
    .select()
    .single();

  if (employeeError) {
    // Clean up: delete profile and auth user on employee creation failure
    await supabase.from("profiles").delete().eq("id", userId);
    await supabase.auth.admin.deleteUser(userId);
    throw employeeError;
  }

  return employee;
}

// Upload employee ID document
export async function uploadEmployeeDocument(
  employeeId: string,
  file: File
): Promise<string> {
  const supabase = createClient();

  const fileExt = file.name.split('.').pop();
  const fileName = `${employeeId}/id-document-${Date.now()}.${fileExt}`;

  const { error: uploadError } = await supabase.storage
    .from('employee-docs')
    .upload(fileName, file);

  if (uploadError) throw uploadError;

  const { data } = supabase.storage
    .from('employee-docs')
    .getPublicUrl(fileName);

  return data.publicUrl;
}

// Get employee shift info (for employee dashboard)
export async function getEmployeeShiftInfo(employeeId: string) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("employees")
    .select("shift_type, shift_start, shift_end, company_name, work_location")
    .eq("id", employeeId)
    .single();

  if (error) throw error;
  return data;
}
