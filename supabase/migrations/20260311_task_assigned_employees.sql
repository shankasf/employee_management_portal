-- Add assigned_employee_ids column to tasks table for recurring task assignment
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_employee_ids UUID[] DEFAULT '{}';

-- Backfill from existing task_instances: for each recurring task, collect distinct employee_ids
UPDATE tasks t
SET assigned_employee_ids = sub.emp_ids
FROM (
  SELECT ti.task_id, ARRAY_AGG(DISTINCT ti.employee_id) AS emp_ids
  FROM task_instances ti
  JOIN tasks tk ON tk.id = ti.task_id
  WHERE tk.is_recurring = true
  GROUP BY ti.task_id
) sub
WHERE t.id = sub.task_id
  AND t.is_recurring = true;
