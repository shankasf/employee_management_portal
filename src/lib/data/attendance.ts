import { createClient, createUntypedClient } from "@/lib/supabase/client";
import { Updatable } from "@/types/supabase";

export async function getOpenAttendance() {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_open_attendance");
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function clockIn() {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("clock_in");
  if (error) throw error;
  return data;
}

export async function clockOut() {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("clock_out");
  if (error) throw error;
  return data;
}

export async function getMyAttendance(startDate?: string, endDate?: string) {
  const supabase = createClient();
  let query = supabase
    .from("attendance_logs")
    .select("*")
    .order("clock_in", { ascending: false });

  if (startDate) {
    query = query.gte("clock_in", startDate);
  }
  if (endDate) {
    query = query.lte("clock_in", endDate);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// Admin functions
export async function getAllAttendance(filters?: {
  employeeId?: string;
  startDate?: string;
  endDate?: string;
}) {
  const supabase = createClient();
  let query = supabase
    .from("attendance_logs")
    .select(
      `
      *,
      employees (
        id,
        display_name,
        position
      )
    `
    )
    .order("clock_in", { ascending: false });

  if (filters?.employeeId) {
    query = query.eq("employee_id", filters.employeeId);
  }
  if (filters?.startDate) {
    query = query.gte("clock_in", filters.startDate);
  }
  if (filters?.endDate) {
    query = query.lte("clock_in", filters.endDate);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function updateAttendance(
  id: string,
  updates: Updatable<"attendance_logs">
) {
  const supabase = createUntypedClient();
  const { data, error } = await supabase
    .from("attendance_logs")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteAttendance(id: string) {
  const supabase = createClient();
  const { error } = await supabase
    .from("attendance_logs")
    .delete()
    .eq("id", id);

  if (error) throw error;
}
