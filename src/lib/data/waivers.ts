import { createClient, createUntypedClient } from "@/lib/supabase/client";
import { Insertable } from "@/types/supabase";

// Search waivers by phone
export async function searchWaivers(phone: string) {
  const supabase = createUntypedClient();
  const { data, error } = await supabase.rpc("search_waivers_by_phone", {
    p_phone: phone,
  });
  if (error) throw error;
  return data;
}

// Get all waivers (admin only)
export async function getWaivers(filters?: {
  phone?: string;
  customerName?: string;
  startDate?: string;
  endDate?: string;
}) {
  const supabase = createClient();
  let query = supabase
    .from("waivers")
    .select("*")
    .order("created_at", { ascending: false });

  if (filters?.phone) {
    query = query.ilike("phone", `%${filters.phone}%`);
  }
  if (filters?.customerName) {
    query = query.ilike("customer_name", `%${filters.customerName}%`);
  }
  if (filters?.startDate) {
    query = query.gte("signed_at", filters.startDate);
  }
  if (filters?.endDate) {
    query = query.lte("signed_at", filters.endDate);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// Create a new waiver record
export async function createWaiver(waiver: Insertable<"waivers">) {
  const supabase = createUntypedClient();
  const { data, error } = await supabase
    .from("waivers")
    .insert(waiver)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Get my staff notes
export async function getMyNotes() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("staff_notes")
    .select(
      `
      *,
      events (
        id,
        title
      )
    `
    )
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data;
}

// Get all staff notes (admin)
export async function getAllNotes(filters?: {
  employeeId?: string;
  eventId?: string;
  startDate?: string;
  endDate?: string;
}) {
  const supabase = createClient();
  let query = supabase
    .from("staff_notes")
    .select(
      `
      *,
      employees (
        id,
        display_name
      ),
      events (
        id,
        title
      )
    `
    )
    .order("created_at", { ascending: false });

  if (filters?.employeeId) {
    query = query.eq("employee_id", filters.employeeId);
  }
  if (filters?.eventId) {
    query = query.eq("event_id", filters.eventId);
  }
  if (filters?.startDate) {
    query = query.gte("created_at", filters.startDate);
  }
  if (filters?.endDate) {
    query = query.lte("created_at", filters.endDate);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// Create a staff note
export async function createStaffNote(note: Insertable<"staff_notes">) {
  const supabase = createUntypedClient();
  const { data, error } = await supabase
    .from("staff_notes")
    .insert(note)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Delete a staff note
export async function deleteStaffNote(id: string) {
  const supabase = createClient();
  const { error } = await supabase.from("staff_notes").delete().eq("id", id);

  if (error) throw error;
}

// Get my recent transactions
export async function getMyRecentTransactions() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("employee_recent_transactions")
    .select("*");

  if (error) throw error;
  return data;
}
