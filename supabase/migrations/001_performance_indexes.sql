-- Performance indexes for common queries
-- Created: 2026-01-11

-- For employees.is_active filtering (used in almost every employee query)
CREATE INDEX IF NOT EXISTS idx_employees_is_active ON employees(is_active) WHERE is_active = true;

-- For open attendance lookups (clock_out IS NULL)
CREATE INDEX IF NOT EXISTS idx_attendance_logs_open ON attendance_logs(employee_id) WHERE clock_out IS NULL;

-- For policy_strips.is_active filtering
CREATE INDEX IF NOT EXISTS idx_policy_strips_active ON policy_strips(is_active, created_at DESC) WHERE is_active = true;

-- For events by start_time (upcoming events)
CREATE INDEX IF NOT EXISTS idx_events_start_time ON events(start_time);

-- For event_staff_assignments by employee (my events lookup)
CREATE INDEX IF NOT EXISTS idx_event_staff_employee ON event_staff_assignments(employee_id);

-- For profiles role lookup (used in middleware)
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(id, role);
