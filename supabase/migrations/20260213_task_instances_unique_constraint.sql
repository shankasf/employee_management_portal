-- Add unique constraint on (task_id, employee_id, scheduled_date) for task_instances
-- Required for the upsert/ON CONFLICT used when generating task instances

-- First, remove any duplicate rows (keep the newest one by updated_at)
DELETE FROM task_instances a
USING task_instances b
WHERE a.task_id = b.task_id
  AND a.employee_id = b.employee_id
  AND a.scheduled_date = b.scheduled_date
  AND a.id < b.id
  AND a.updated_at <= b.updated_at;

-- Now add the unique constraint
ALTER TABLE task_instances
  ADD CONSTRAINT task_instances_task_employee_date_unique
  UNIQUE (task_id, employee_id, scheduled_date);
