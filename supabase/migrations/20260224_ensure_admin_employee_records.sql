-- Ensure all admin profiles have corresponding employee records.
-- This allows admins to be assigned tasks via the task_instances system
-- (which references employees.id via employee_id FK).

INSERT INTO employees (id, display_name, position, is_active)
SELECT p.id, COALESCE(p.full_name, p.email, 'Admin'), 'Admin', true
FROM profiles p
LEFT JOIN employees e ON e.id = p.id
WHERE p.role = 'admin' AND e.id IS NULL;
