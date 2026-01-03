import { createClient, createUntypedClient } from "@/lib/supabase/client";
import { Insertable, Updatable } from "@/types/supabase";

// Get all task definitions
export async function getTasks() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .order("title");

  if (error) throw error;
  return data;
}

// Get a single task
export async function getTask(id: string) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
}

// Create a new task
export async function createTask(task: Insertable<"tasks">) {
  const supabase = createUntypedClient();
  const { data, error } = await supabase
    .from("tasks")
    .insert(task)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Update a task
export async function updateTask(id: string, updates: Updatable<"tasks">) {
  const supabase = createUntypedClient();
  const { data, error } = await supabase
    .from("tasks")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Delete a task
export async function deleteTask(id: string) {
  const supabase = createClient();
  const { error } = await supabase.from("tasks").delete().eq("id", id);

  if (error) throw error;
}

// Get today's tasks for current employee
export async function getTodayTasks() {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_today_tasks");
  if (error) throw error;
  return data;
}

// Complete a task
export async function completeTask(
  taskInstanceId: string,
  notes?: string,
  photoUrl?: string,
  videoUrl?: string
) {
  const supabase = createUntypedClient();
  const { data, error } = await supabase.rpc("complete_task", {
    p_task_instance_id: taskInstanceId,
    p_notes: notes,
    p_photo_url: photoUrl,
    p_video_url: videoUrl,
  });
  if (error) throw error;
  return data;
}

// Get task instances with filters
export async function getTaskInstances(filters?: {
  employeeId?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
}) {
  const supabase = createClient();
  let query = supabase
    .from("task_instances")
    .select(
      `
      *,
      tasks (
        id,
        title,
        description,
        location,
        requires_photo,
        requires_video,
        requires_notes
      ),
      employees (
        id,
        display_name
      )
    `
    )
    .order("scheduled_date", { ascending: false });

  if (filters?.employeeId) {
    query = query.eq("employee_id", filters.employeeId);
  }
  if (filters?.startDate) {
    query = query.gte("scheduled_date", filters.startDate);
  }
  if (filters?.endDate) {
    query = query.lte("scheduled_date", filters.endDate);
  }
  if (filters?.status) {
    query = query.eq("status", filters.status);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// Create task instance (assign task to employee)
export async function createTaskInstance(
  instance: Insertable<"task_instances">
) {
  const supabase = createUntypedClient();
  const { data, error } = await supabase
    .from("task_instances")
    .insert(instance)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Update task instance
export async function updateTaskInstance(
  id: string,
  updates: Updatable<"task_instances">
) {
  const supabase = createUntypedClient();
  const { data, error } = await supabase
    .from("task_instances")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Delete task instance
export async function deleteTaskInstance(id: string) {
  const supabase = createClient();
  const { error } = await supabase.from("task_instances").delete().eq("id", id);

  if (error) throw error;
}

// Get task completion stats for admin
export async function getTaskStats(date?: string) {
  const supabase = createUntypedClient();
  const targetDate = date || new Date().toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("task_instances")
    .select("status")
    .eq("scheduled_date", targetDate);

  if (error) throw error;

  interface TaskStatus {
    status: string;
  }

  const stats = {
    total: data?.length || 0,
    completed:
      data?.filter((t: TaskStatus) => t.status === "completed").length || 0,
    pending:
      data?.filter((t: TaskStatus) => t.status === "pending").length || 0,
    overdue:
      data?.filter((t: TaskStatus) => t.status === "overdue").length || 0,
  };

  return stats;
}
