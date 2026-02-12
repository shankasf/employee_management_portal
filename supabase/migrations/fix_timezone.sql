-- Fix all RPC functions to use New York timezone instead of CURRENT_DATE (UTC)

-- Fix get_today_tasks to use NY timezone
CREATE OR REPLACE FUNCTION get_today_tasks()
RETURNS TABLE (id UUID, task_id UUID, title TEXT, description TEXT, location TEXT, status TEXT, cutoff_time TIME, requires_photo BOOLEAN, requires_video BOOLEAN, requires_notes BOOLEAN, scheduled_date DATE) AS $$
DECLARE
  v_today DATE := (NOW() AT TIME ZONE 'America/New_York')::DATE;
BEGIN
  RETURN QUERY
  SELECT ti.id, ti.task_id, t.title, t.description, t.location, ti.status, t.cutoff_time, t.requires_photo, t.requires_video, t.requires_notes, ti.scheduled_date
  FROM task_instances ti JOIN tasks t ON t.id = ti.task_id
  WHERE ti.employee_id = auth.uid() AND ti.scheduled_date = v_today
  ORDER BY t.cutoff_time ASC NULLS LAST;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Fix get_employee_dashboard_data to use NY timezone
CREATE OR REPLACE FUNCTION get_employee_dashboard_data(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result JSONB;
    v_today DATE := (NOW() AT TIME ZONE 'America/New_York')::DATE;
BEGIN
    SELECT jsonb_build_object(
        'open_attendance', (
            SELECT jsonb_build_object('id', id, 'clock_in', clock_in)
            FROM attendance_logs WHERE employee_id = p_user_id AND clock_out IS NULL
            ORDER BY clock_in DESC LIMIT 1
        ),
        'today_tasks', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', ti.id, 'task_id', ti.task_id, 'status', ti.status,
                'title', t.title, 'description', t.description, 'location', t.location,
                'cutoff_time', t.cutoff_time, 'requires_photo', t.requires_photo,
                'requires_video', t.requires_video, 'requires_notes', t.requires_notes
            ))
            FROM task_instances ti JOIN tasks t ON t.id = ti.task_id
            WHERE ti.employee_id = p_user_id AND ti.scheduled_date = v_today LIMIT 10
        ), '[]'::jsonb),
        'upcoming_events', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', e.id, 'title', e.title, 'start_time', e.start_time,
                'end_time', e.end_time, 'room', e.room, 'my_role', esa.role
            ))
            FROM events e JOIN event_staff_assignments esa ON esa.event_id = e.id
            WHERE esa.employee_id = p_user_id AND e.start_time >= NOW()
            ORDER BY e.start_time ASC LIMIT 5
        ), '[]'::jsonb),
        'shift_info', (
            SELECT jsonb_build_object(
                'shift_type', e.shift_type, 'shift_start', e.shift_start,
                'shift_end', e.shift_end, 'company_name', e.company_name,
                'work_location', e.work_location
            )
            FROM employees e WHERE e.id = p_user_id
        ),
        'device_info', (
            SELECT jsonb_build_object(
                'registered_device_id', e.registered_device_id,
                'device_name', e.device_name
            )
            FROM employees e WHERE e.id = p_user_id
        )
    ) INTO result;
    RETURN result;
END;
$$;

-- Fix get_schedule_stats to use NY timezone
CREATE OR REPLACE FUNCTION get_schedule_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result JSONB;
    v_today DATE := (NOW() AT TIME ZONE 'America/New_York')::DATE;
BEGIN
    SELECT jsonb_build_object(
        'pending', COUNT(*) FILTER (WHERE status = 'pending'),
        'cancellation_requested', COUNT(*) FILTER (WHERE status = 'cancellation_requested'),
        'today_schedules', COUNT(*) FILTER (WHERE schedule_date = v_today AND status != 'cancelled')
    ) INTO result FROM schedules;
    RETURN result;
END;
$$;

-- Fix get_my_schedules default parameter to use NY timezone
CREATE OR REPLACE FUNCTION get_my_schedules(p_start_date DATE DEFAULT NULL, p_end_date DATE DEFAULT NULL)
RETURNS TABLE (id UUID, schedule_date DATE, start_time TIME, end_time TIME, title TEXT, description TEXT, location TEXT, status TEXT, confirmed_at TIMESTAMPTZ, cancellation_reason TEXT) AS $$
DECLARE
  v_today DATE := (NOW() AT TIME ZONE 'America/New_York')::DATE;
  v_start DATE := COALESCE(p_start_date, v_today);
BEGIN
  RETURN QUERY SELECT s.id, s.schedule_date, s.start_time, s.end_time, s.title, s.description, s.location, s.status, s.confirmed_at, s.cancellation_reason
  FROM schedules s WHERE s.employee_id = auth.uid() AND s.schedule_date >= v_start AND (p_end_date IS NULL OR s.schedule_date <= p_end_date)
  ORDER BY s.schedule_date ASC, s.start_time ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
