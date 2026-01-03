import { createClient, createUntypedClient } from "@/lib/supabase/client";
import { Insertable, Updatable } from "@/types/supabase";

// Get all events
export async function getEvents(filters?: {
  startDate?: string;
  endDate?: string;
  room?: string;
}) {
  const supabase = createClient();
  let query = supabase
    .from("events")
    .select(
      `
      *,
      event_staff_assignments (
        id,
        role,
        employee_id,
        employees (
          id,
          display_name
        )
      )
    `
    )
    .order("start_time", { ascending: true });

  if (filters?.startDate) {
    query = query.gte("start_time", filters.startDate);
  }
  if (filters?.endDate) {
    query = query.lte("start_time", filters.endDate);
  }
  if (filters?.room) {
    query = query.eq("room", filters.room);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// Get a single event
export async function getEvent(id: string) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("events")
    .select(
      `
      *,
      event_staff_assignments (
        id,
        role,
        employee_id,
        employees (
          id,
          display_name,
          position
        )
      ),
      event_checklists (
        id,
        task_title,
        status,
        completed_by,
        completed_at
      )
    `
    )
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
}

// Create a new event
export async function createEvent(event: Insertable<"events">) {
  const supabase = createUntypedClient();
  const { data, error } = await supabase
    .from("events")
    .insert(event)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Update an event
export async function updateEvent(id: string, updates: Updatable<"events">) {
  const supabase = createUntypedClient();
  const { data, error } = await supabase
    .from("events")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Delete an event
export async function deleteEvent(id: string) {
  const supabase = createClient();
  const { error } = await supabase.from("events").delete().eq("id", id);

  if (error) throw error;
}

// Get my upcoming events (for employees)
export async function getMyUpcomingEvents(limit = 5) {
  const supabase = createUntypedClient();
  const { data, error } = await supabase.rpc("get_my_upcoming_events", {
    p_limit: limit,
  });
  if (error) throw error;
  return data;
}

// Assign staff to event
export async function assignStaffToEvent(
  eventId: string,
  employeeId: string,
  role: string
) {
  const supabase = createUntypedClient();
  const { data, error } = await supabase
    .from("event_staff_assignments")
    .insert({
      event_id: eventId,
      employee_id: employeeId,
      role,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Remove staff from event
export async function removeStaffFromEvent(assignmentId: string) {
  const supabase = createClient();
  const { error } = await supabase
    .from("event_staff_assignments")
    .delete()
    .eq("id", assignmentId);

  if (error) throw error;
}

// Add checklist item to event
export async function addChecklistItem(eventId: string, taskTitle: string) {
  const supabase = createUntypedClient();
  const { data, error } = await supabase
    .from("event_checklists")
    .insert({
      event_id: eventId,
      task_title: taskTitle,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Complete checklist item
export async function completeChecklistItem(
  checklistId: string,
  completedBy: string
) {
  const supabase = createUntypedClient();
  const { data, error } = await supabase
    .from("event_checklists")
    .update({
      status: "completed",
      completed_by: completedBy,
      completed_at: new Date().toISOString(),
    })
    .eq("id", checklistId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Delete checklist item
export async function deleteChecklistItem(checklistId: string) {
  const supabase = createClient();
  const { error } = await supabase
    .from("event_checklists")
    .delete()
    .eq("id", checklistId);

  if (error) throw error;
}

// Get today's events
export async function getTodayEvents() {
  const supabase = createClient();
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).toISOString();
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).toISOString();

  const { data, error } = await supabase
    .from("events")
    .select(
      `
      *,
      event_staff_assignments (
        id,
        role,
        employee_id,
        employees (
          id,
          display_name
        )
      )
    `
    )
    .gte("start_time", startOfDay)
    .lte("start_time", endOfDay)
    .order("start_time");

  if (error) throw error;
  return data;
}

// Get event count for date range
export async function getEventCount(startDate?: string, endDate?: string) {
  const supabase = createClient();
  let query = supabase
    .from("events")
    .select("*", { count: "exact", head: true });

  if (startDate) {
    query = query.gte("start_time", startDate);
  }
  if (endDate) {
    query = query.lte("start_time", endDate);
  }

  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}
