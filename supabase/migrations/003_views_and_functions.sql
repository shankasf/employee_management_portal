-- Supabase SQL Migration: 003_views_and_functions.sql
-- Secure Views and Additional Functions

-- =====================================================
-- View: employee_recent_transactions
-- Purpose: Give employees a safe view of their last 5 transactions
-- =====================================================
CREATE OR REPLACE VIEW employee_recent_transactions AS
SELECT t.id, t.event_id, t.customer_name, t.phone, t.amount, t.payment_method, t.created_at, t.handled_by_employee
FROM transactions t
WHERE
    t.handled_by_employee = auth.uid ()
ORDER BY t.created_at DESC
LIMIT 5;

-- Grant access to authenticated users
GRANT SELECT ON employee_recent_transactions TO authenticated;

-- =====================================================
-- Function: Get employee's open attendance record
-- Purpose: Check if employee has an active clock-in
-- =====================================================
CREATE OR REPLACE FUNCTION get_open_attendance()
RETURNS TABLE (
  id UUID,
  clock_in TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT al.id, al.clock_in
  FROM attendance_logs al
  WHERE al.employee_id = auth.uid()
  AND al.clock_out IS NULL
  ORDER BY al.clock_in DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- Function: Clock in
-- Purpose: Create a new attendance record
-- =====================================================
CREATE OR REPLACE FUNCTION clock_in()
RETURNS UUID AS $$
DECLARE
  new_id UUID;
BEGIN
  -- Check if already clocked in
  IF EXISTS (
    SELECT 1 FROM attendance_logs
    WHERE employee_id = auth.uid()
    AND clock_out IS NULL
  ) THEN
    RAISE EXCEPTION 'Already clocked in';
  END IF;

  INSERT INTO attendance_logs (employee_id, clock_in)
  VALUES (auth.uid(), NOW())
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- Function: Clock out
-- Purpose: Update the open attendance record with clock_out time
-- =====================================================
CREATE OR REPLACE FUNCTION clock_out()
RETURNS UUID AS $$
DECLARE
  attendance_id UUID;
BEGIN
  -- Find open attendance record
  SELECT id INTO attendance_id
  FROM attendance_logs
  WHERE employee_id = auth.uid()
  AND clock_out IS NULL
  ORDER BY clock_in DESC
  LIMIT 1;

  IF attendance_id IS NULL THEN
    RAISE EXCEPTION 'Not clocked in';
  END IF;

  UPDATE attendance_logs
  SET clock_out = NOW()
  WHERE id = attendance_id;

  RETURN attendance_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- Function: Get today's tasks for employee
-- Purpose: Fetch all task instances for today
-- =====================================================
CREATE OR REPLACE FUNCTION get_today_tasks()
RETURNS TABLE (
  id UUID,
  task_id UUID,
  title TEXT,
  description TEXT,
  location TEXT,
  status TEXT,
  cutoff_time TIME,
  requires_photo BOOLEAN,
  requires_video BOOLEAN,
  requires_notes BOOLEAN,
  scheduled_date DATE
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ti.id,
    ti.task_id,
    t.title,
    t.description,
    t.location,
    ti.status,
    t.cutoff_time,
    t.requires_photo,
    t.requires_video,
    t.requires_notes,
    ti.scheduled_date
  FROM task_instances ti
  JOIN tasks t ON t.id = ti.task_id
  WHERE ti.employee_id = auth.uid()
  AND ti.scheduled_date = CURRENT_DATE
  ORDER BY t.cutoff_time ASC NULLS LAST;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- Function: Complete a task
-- Purpose: Mark a task instance as completed
-- =====================================================
CREATE OR REPLACE FUNCTION complete_task(
  p_task_instance_id UUID,
  p_notes TEXT DEFAULT NULL,
  p_photo_url TEXT DEFAULT NULL,
  p_video_url TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
  task_record RECORD;
BEGIN
  -- Get task instance and verify ownership
  SELECT ti.*, t.requires_photo, t.requires_video, t.requires_notes
  INTO task_record
  FROM task_instances ti
  JOIN tasks t ON t.id = ti.task_id
  WHERE ti.id = p_task_instance_id
  AND ti.employee_id = auth.uid();

  IF task_record IS NULL THEN
    RAISE EXCEPTION 'Task not found or not assigned to you';
  END IF;

  -- Validate requirements
  IF task_record.requires_photo AND p_photo_url IS NULL THEN
    RAISE EXCEPTION 'Photo is required for this task';
  END IF;

  IF task_record.requires_video AND p_video_url IS NULL THEN
    RAISE EXCEPTION 'Video is required for this task';
  END IF;

  IF task_record.requires_notes AND (p_notes IS NULL OR p_notes = '') THEN
    RAISE EXCEPTION 'Notes are required for this task';
  END IF;

  -- Update task instance
  UPDATE task_instances
  SET 
    status = 'completed',
    completed_at = NOW(),
    notes = p_notes,
    photo_url = p_photo_url,
    video_url = p_video_url
  WHERE id = p_task_instance_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- Function: Get upcoming events for employee
-- Purpose: Fetch events the employee is assigned to
-- =====================================================
CREATE OR REPLACE FUNCTION get_my_upcoming_events(p_limit INTEGER DEFAULT 5)
RETURNS TABLE (
  id UUID,
  title TEXT,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  room TEXT,
  expected_headcount INTEGER,
  notes TEXT,
  my_role TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    e.id,
    e.title,
    e.start_time,
    e.end_time,
    e.room,
    e.expected_headcount,
    e.notes,
    esa.role AS my_role
  FROM events e
  JOIN event_staff_assignments esa ON esa.event_id = e.id
  WHERE esa.employee_id = auth.uid()
  AND e.start_time >= NOW()
  ORDER BY e.start_time ASC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- Function: Search waivers by phone
-- Purpose: Allow employees to search waivers
-- =====================================================
CREATE OR REPLACE FUNCTION search_waivers_by_phone(p_phone TEXT)
RETURNS TABLE (
  id UUID,
  phone TEXT,
  customer_name TEXT,
  signed_at TIMESTAMPTZ,
  waiver_url TEXT
) AS $$
BEGIN
  -- Limit results and only return necessary fields
  RETURN QUERY
  SELECT 
    w.id,
    w.phone,
    w.customer_name,
    w.signed_at,
    w.waiver_url
  FROM waivers w
  WHERE w.phone LIKE '%' || p_phone || '%'
  ORDER BY w.signed_at DESC
  LIMIT 10;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- Function: Get dashboard stats for admin
-- Purpose: Return aggregated stats for admin dashboard
-- =====================================================
CREATE OR REPLACE FUNCTION get_admin_dashboard_stats()
RETURNS TABLE (
  active_employees BIGINT,
  clocked_in_today BIGINT,
  tasks_completed_today BIGINT,
  tasks_pending_today BIGINT,
  events_today BIGINT,
  events_this_week BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM employees WHERE is_active = TRUE) AS active_employees,
    (SELECT COUNT(*) FROM attendance_logs 
     WHERE DATE(clock_in) = CURRENT_DATE AND clock_out IS NULL) AS clocked_in_today,
    (SELECT COUNT(*) FROM task_instances 
     WHERE scheduled_date = CURRENT_DATE AND status = 'completed') AS tasks_completed_today,
    (SELECT COUNT(*) FROM task_instances 
     WHERE scheduled_date = CURRENT_DATE AND status = 'pending') AS tasks_pending_today,
    (SELECT COUNT(*) FROM events 
     WHERE DATE(start_time) = CURRENT_DATE) AS events_today,
    (SELECT COUNT(*) FROM events 
     WHERE start_time >= CURRENT_DATE 
     AND start_time < CURRENT_DATE + INTERVAL '7 days') AS events_this_week;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;