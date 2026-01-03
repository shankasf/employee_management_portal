import { createClient, createUntypedClient } from "@/lib/supabase/client";
import { Insertable, Updatable, ScheduleStatus, ScheduleEmailType } from "@/types/supabase";

// Get all schedules with employee info (admin view)
export async function getAllSchedules(filters?: {
  startDate?: string;
  endDate?: string;
  status?: ScheduleStatus;
  employeeId?: string;
}) {
  const supabase = createClient();
  let query = supabase
    .from("schedules")
    .select(
      `
      *,
      employee:employees (
        id,
        display_name,
        position,
        profiles (
          email,
          full_name
        )
      ),
      created_by_profile:profiles!schedules_created_by_fkey (
        full_name,
        email
      )
    `
    )
    .order("schedule_date", { ascending: true })
    .order("start_time", { ascending: true });

  if (filters?.startDate) {
    query = query.gte("schedule_date", filters.startDate);
  }
  if (filters?.endDate) {
    query = query.lte("schedule_date", filters.endDate);
  }
  if (filters?.status) {
    query = query.eq("status", filters.status);
  }
  if (filters?.employeeId) {
    query = query.eq("employee_id", filters.employeeId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// Get schedules for a specific employee
export async function getEmployeeSchedules(
  employeeId: string,
  startDate?: string,
  endDate?: string
) {
  const supabase = createClient();
  let query = supabase
    .from("schedules")
    .select("*")
    .eq("employee_id", employeeId)
    .order("schedule_date", { ascending: true })
    .order("start_time", { ascending: true });

  if (startDate) {
    query = query.gte("schedule_date", startDate);
  }
  if (endDate) {
    query = query.lte("schedule_date", endDate);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// Schedule with employee type
interface ScheduleWithEmployee {
  id: string;
  employee_id: string;
  schedule_date: string;
  start_time: string;
  end_time: string;
  title: string | null;
  description: string | null;
  location: string | null;
  status: ScheduleStatus;
  confirmed_at: string | null;
  cancellation_requested_at: string | null;
  cancellation_reason: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  employee?: {
    id: string;
    display_name: string | null;
    position: string | null;
    profiles?: {
      email: string | null;
      full_name: string | null;
    } | null;
  } | null;
}

// Get a single schedule
export async function getSchedule(id: string): Promise<ScheduleWithEmployee> {
  const supabase = createUntypedClient();
  const { data, error } = await supabase
    .from("schedules")
    .select(
      `
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
    `
    )
    .eq("id", id)
    .single();

  if (error) throw error;
  return data as ScheduleWithEmployee;
}

// Create a new schedule (admin only)
export async function createSchedule(
  scheduleData: Omit<Insertable<"schedules">, "id" | "created_at" | "updated_at">
) {
  const supabase = createUntypedClient();
  const { data, error } = await supabase
    .from("schedules")
    .insert(scheduleData)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Create multiple schedules at once (for bulk scheduling)
export async function createBulkSchedules(
  schedules: Omit<Insertable<"schedules">, "id" | "created_at" | "updated_at">[]
) {
  const supabase = createUntypedClient();
  const { data, error } = await supabase
    .from("schedules")
    .insert(schedules)
    .select();

  if (error) throw error;
  return data;
}

// Update a schedule (admin only)
export async function updateSchedule(
  id: string,
  updates: Updatable<"schedules">
) {
  const supabase = createUntypedClient();
  const { data, error } = await supabase
    .from("schedules")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Delete a schedule (admin only)
export async function deleteSchedule(id: string) {
  const supabase = createUntypedClient();
  const { error } = await supabase
    .from("schedules")
    .delete()
    .eq("id", id);

  if (error) throw error;
  return true;
}

// Employee confirms their schedule
export async function confirmSchedule(scheduleId: string) {
  const supabase = createUntypedClient();

  // Try using RPC first
  try {
    const { data, error } = await supabase.rpc("confirm_schedule", {
      p_schedule_id: scheduleId,
    });
    if (error) throw error;
    return data;
  } catch {
    // Fallback to direct update
    const { data, error } = await supabase
      .from("schedules")
      .update({
        status: "confirmed" as ScheduleStatus,
        confirmed_at: new Date().toISOString(),
      })
      .eq("id", scheduleId)
      .eq("status", "pending")
      .select()
      .single();

    if (error) throw error;
    return data;
  }
}

// Employee requests cancellation
export async function requestScheduleCancellation(
  scheduleId: string,
  reason: string
) {
  const supabase = createUntypedClient();

  // Try using RPC first
  try {
    const { data, error } = await supabase.rpc("request_schedule_cancellation", {
      p_schedule_id: scheduleId,
      p_reason: reason,
    });
    if (error) throw error;
    return data;
  } catch {
    // Fallback to direct update
    const { data, error } = await supabase
      .from("schedules")
      .update({
        status: "cancellation_requested" as ScheduleStatus,
        cancellation_requested_at: new Date().toISOString(),
        cancellation_reason: reason,
      })
      .eq("id", scheduleId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }
}

// Admin approves cancellation request
export async function approveCancellation(scheduleId: string, adminId: string) {
  const supabase = createUntypedClient();
  const { data, error } = await supabase
    .from("schedules")
    .update({
      status: "cancelled" as ScheduleStatus,
      cancelled_at: new Date().toISOString(),
      cancelled_by: adminId,
    })
    .eq("id", scheduleId)
    .eq("status", "cancellation_requested")
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Admin cancels schedule directly (no approval needed)
export async function adminCancelSchedule(
  scheduleId: string,
  adminId: string,
  reason?: string
) {
  const supabase = createUntypedClient();
  const { data, error } = await supabase
    .from("schedules")
    .update({
      status: "cancelled" as ScheduleStatus,
      cancelled_at: new Date().toISOString(),
      cancelled_by: adminId,
      cancellation_reason: reason || "Cancelled by admin",
    })
    .eq("id", scheduleId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Get pending cancellation requests (admin view)
export async function getPendingCancellations() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("schedules")
    .select(
      `
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
    `
    )
    .eq("status", "cancellation_requested")
    .order("cancellation_requested_at", { ascending: true });

  if (error) throw error;
  return data;
}

// Get schedules pending confirmation (admin view)
export async function getPendingConfirmations() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("schedules")
    .select(
      `
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
    `
    )
    .eq("status", "pending")
    .order("schedule_date", { ascending: true });

  if (error) throw error;
  return data;
}

// Get today's schedules for an employee
export async function getTodaySchedules(employeeId: string) {
  const supabase = createClient();
  const today = new Date().toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("schedules")
    .select("*")
    .eq("employee_id", employeeId)
    .eq("schedule_date", today)
    .neq("status", "cancelled")
    .order("start_time", { ascending: true });

  if (error) throw error;
  return data;
}

// Get upcoming schedules for an employee (next 7 days)
export async function getUpcomingSchedules(employeeId: string, days: number = 7) {
  const supabase = createClient();
  const today = new Date().toISOString().split("T")[0];
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + days);
  const endDateStr = endDate.toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("schedules")
    .select("*")
    .eq("employee_id", employeeId)
    .gte("schedule_date", today)
    .lte("schedule_date", endDateStr)
    .neq("status", "cancelled")
    .order("schedule_date", { ascending: true })
    .order("start_time", { ascending: true });

  if (error) throw error;
  return data;
}

// Get schedule counts by status (for admin dashboard)
export async function getScheduleStats() {
  const supabase = createClient();

  const { count: pendingCount, error: pendingError } = await supabase
    .from("schedules")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending");

  const { count: cancellationRequestedCount, error: cancelError } = await supabase
    .from("schedules")
    .select("*", { count: "exact", head: true })
    .eq("status", "cancellation_requested");

  const today = new Date().toISOString().split("T")[0];
  const { count: todaySchedulesCount, error: todayError } = await supabase
    .from("schedules")
    .select("*", { count: "exact", head: true })
    .eq("schedule_date", today)
    .neq("status", "cancelled");

  if (pendingError || cancelError || todayError) {
    throw pendingError || cancelError || todayError;
  }

  return {
    pending: pendingCount || 0,
    cancellationRequested: cancellationRequestedCount || 0,
    todaySchedules: todaySchedulesCount || 0,
  };
}

// =====================================================
// Notification Recipients Management
// =====================================================

// Notification recipient type
interface NotificationRecipient {
  id: string;
  email: string;
  name: string;
  recipient_type: "manager" | "owner";
  is_active: boolean;
  created_at: string;
}

// Get all notification recipients
export async function getNotificationRecipients(): Promise<NotificationRecipient[]> {
  const supabase = createUntypedClient();
  const { data, error } = await supabase
    .from("notification_recipients")
    .select("*")
    .order("recipient_type")
    .order("name");

  if (error) throw error;
  return data as NotificationRecipient[];
}

// Add notification recipient
export async function addNotificationRecipient(
  email: string,
  name: string,
  recipientType: "manager" | "owner"
) {
  const supabase = createUntypedClient();
  const { data, error } = await supabase
    .from("notification_recipients")
    .insert({
      email,
      name,
      recipient_type: recipientType,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Remove notification recipient
export async function removeNotificationRecipient(id: string) {
  const supabase = createUntypedClient();
  const { error } = await supabase
    .from("notification_recipients")
    .delete()
    .eq("id", id);

  if (error) throw error;
  return true;
}

// Toggle notification recipient active status
export async function toggleNotificationRecipient(id: string, isActive: boolean) {
  const supabase = createUntypedClient();
  const { data, error } = await supabase
    .from("notification_recipients")
    .update({ is_active: isActive })
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// =====================================================
// Email Logging (for tracking sent notifications)
// =====================================================

// Log an email that was sent
export async function logScheduleEmail(
  scheduleId: string,
  emailType: ScheduleEmailType,
  recipientEmail: string,
  recipientType: "employee" | "manager" | "owner",
  status: "sent" | "failed" = "sent",
  errorMessage?: string
) {
  const supabase = createUntypedClient();
  const { data, error } = await supabase
    .from("schedule_email_logs")
    .insert({
      schedule_id: scheduleId,
      email_type: emailType,
      recipient_email: recipientEmail,
      recipient_type: recipientType,
      status,
      error_message: errorMessage,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Get email logs for a schedule
export async function getScheduleEmailLogs(scheduleId: string) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("schedule_email_logs")
    .select("*")
    .eq("schedule_id", scheduleId)
    .order("sent_at", { ascending: false });

  if (error) throw error;
  return data;
}

// =====================================================
// Email Sending (using Supabase Edge Functions or external service)
// =====================================================

// Send schedule confirmation emails
export async function sendScheduleConfirmationEmails(scheduleId: string) {
  // Get schedule with employee details
  const schedule = await getSchedule(scheduleId);
  if (!schedule) throw new Error("Schedule not found");

  // Get notification recipients
  const recipients = await getNotificationRecipients();
  const activeRecipients = recipients.filter((r) => r.is_active);

  // Get employee email
  const employeeEmail = schedule.employee?.profiles?.email;
  const employeeName = schedule.employee?.display_name || "Employee";

  // Prepare email data
  const emailData = {
    scheduleId,
    employeeName,
    scheduleDate: schedule.schedule_date,
    startTime: schedule.start_time,
    endTime: schedule.end_time,
    location: schedule.location,
    title: schedule.title,
  };

  // In production, this would call a Supabase Edge Function or external email service
  // For now, we'll just log the emails that would be sent
  const emailsSent: Array<{
    email: string;
    type: "employee" | "manager" | "owner";
  }> = [];

  // Log employee email
  if (employeeEmail) {
    await logScheduleEmail(
      scheduleId,
      "schedule_confirmed",
      employeeEmail,
      "employee"
    );
    emailsSent.push({ email: employeeEmail, type: "employee" });
  }

  // Log manager/owner emails
  for (const recipient of activeRecipients) {
    await logScheduleEmail(
      scheduleId,
      "schedule_confirmed",
      recipient.email,
      recipient.recipient_type
    );
    emailsSent.push({
      email: recipient.email,
      type: recipient.recipient_type,
    });
  }

  // Update schedule to mark confirmation email as sent
  await updateSchedule(scheduleId, { confirmation_email_sent: true });

  return { emailsSent, emailData };
}

// Send cancellation emails
export async function sendCancellationEmails(
  scheduleId: string,
  cancelledByAdmin: boolean
) {
  const schedule = await getSchedule(scheduleId);
  if (!schedule) throw new Error("Schedule not found");

  const recipients = await getNotificationRecipients();
  const activeRecipients = recipients.filter((r) => r.is_active);

  const employeeEmail = schedule.employee?.profiles?.email;
  const employeeName = schedule.employee?.display_name || "Employee";

  const emailType: ScheduleEmailType = cancelledByAdmin
    ? "schedule_cancelled_by_admin"
    : "cancellation_approved";

  const emailsSent: Array<{
    email: string;
    type: "employee" | "manager" | "owner";
  }> = [];

  // Log employee email
  if (employeeEmail) {
    await logScheduleEmail(scheduleId, emailType, employeeEmail, "employee");
    emailsSent.push({ email: employeeEmail, type: "employee" });
  }

  // Log manager/owner emails
  for (const recipient of activeRecipients) {
    await logScheduleEmail(
      scheduleId,
      emailType,
      recipient.email,
      recipient.recipient_type
    );
    emailsSent.push({
      email: recipient.email,
      type: recipient.recipient_type,
    });
  }

  // Update schedule to mark cancellation email as sent
  await updateSchedule(scheduleId, { cancellation_email_sent: true });

  return { emailsSent, employeeName };
}
