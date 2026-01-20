-- Performance RPC functions for reduced database round-trips
-- Created: 2026-01-20
--
-- IMPORTANT: Run this migration in your Supabase SQL editor to enable
-- combined data fetching which significantly reduces latency.

-- ============================================
-- ADDITIONAL PERFORMANCE INDEXES
-- ============================================

-- For schedules filtering by date range and status
CREATE INDEX IF NOT EXISTS idx_schedules_date_status
ON schedules(schedule_date, status);

-- For schedules by employee and date (employee dashboard)
CREATE INDEX IF NOT EXISTS idx_schedules_employee_date
ON schedules(employee_id, schedule_date);

-- For task_instances by employee and scheduled_date
CREATE INDEX IF NOT EXISTS idx_task_instances_employee_date
ON task_instances(employee_id, scheduled_date);

-- For attendance_logs by date range (admin attendance page)
CREATE INDEX IF NOT EXISTS idx_attendance_logs_clock_in
ON attendance_logs(clock_in);

-- ============================================
-- COMBINED EMPLOYEE DASHBOARD RPC
-- ============================================
-- Fetches all employee dashboard data in a single query
-- Reduces 5 separate queries to 1 database call

CREATE OR REPLACE FUNCTION get_employee_dashboard_data(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result JSONB;
    v_today DATE := CURRENT_DATE;
BEGIN
    SELECT jsonb_build_object(
        -- Open attendance (clocked in status)
        'open_attendance', (
            SELECT jsonb_build_object('id', id, 'clock_in', clock_in)
            FROM attendance_logs
            WHERE employee_id = p_user_id
              AND clock_out IS NULL
            ORDER BY clock_in DESC
            LIMIT 1
        ),

        -- Today's tasks
        'today_tasks', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', ti.id,
                'task_id', ti.task_id,
                'status', ti.status,
                'title', t.title,
                'description', t.description,
                'location', t.location,
                'cutoff_time', t.cutoff_time,
                'requires_photo', t.requires_photo,
                'requires_video', t.requires_video,
                'requires_notes', t.requires_notes
            ))
            FROM task_instances ti
            JOIN tasks t ON t.id = ti.task_id
            WHERE ti.employee_id = p_user_id
              AND ti.scheduled_date = v_today
            LIMIT 10
        ), '[]'::jsonb),

        -- Upcoming events
        'upcoming_events', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', e.id,
                'title', e.title,
                'start_time', e.start_time,
                'end_time', e.end_time,
                'room', e.room,
                'my_role', esa.role
            ))
            FROM event_staff_assignments esa
            JOIN events e ON e.id = esa.event_id
            WHERE esa.employee_id = p_user_id
              AND e.start_time >= NOW()
            ORDER BY e.start_time
            LIMIT 5
        ), '[]'::jsonb),

        -- Active policies
        'active_policies', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', id,
                'title', title,
                'content', content,
                'category', category
            ))
            FROM policy_strips
            WHERE is_active = true
            ORDER BY created_at DESC
            LIMIT 5
        ), '[]'::jsonb),

        -- Device info
        'device_info', (
            SELECT jsonb_build_object(
                'registered_device_id', registered_device_id,
                'device_name', device_name
            )
            FROM employees
            WHERE id = p_user_id
        )
    ) INTO result;

    RETURN result;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_employee_dashboard_data(UUID) TO authenticated;

-- ============================================
-- COMBINED ADMIN SCHEDULES PAGE RPC
-- ============================================
-- Fetches schedules with employee data and active employees list
-- for the admin schedules page in a single query

CREATE OR REPLACE FUNCTION get_admin_schedules_page_data(
    p_start_date DATE DEFAULT CURRENT_DATE,
    p_end_date DATE DEFAULT CURRENT_DATE + INTERVAL '30 days',
    p_status TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT jsonb_build_object(
        -- Schedules with employee info
        'schedules', COALESCE((
            SELECT jsonb_agg(
                jsonb_build_object(
                    'id', s.id,
                    'employee_id', s.employee_id,
                    'schedule_date', s.schedule_date,
                    'start_time', s.start_time,
                    'end_time', s.end_time,
                    'title', s.title,
                    'description', s.description,
                    'location', s.location,
                    'status', s.status,
                    'cancellation_reason', s.cancellation_reason,
                    'employee', jsonb_build_object(
                        'id', e.id,
                        'display_name', e.display_name,
                        'position', e.position,
                        'profiles', jsonb_build_object(
                            'email', p.email,
                            'full_name', p.full_name
                        )
                    )
                )
                ORDER BY s.schedule_date, s.start_time
            )
            FROM schedules s
            LEFT JOIN employees e ON e.id = s.employee_id
            LEFT JOIN profiles p ON p.id = s.employee_id
            WHERE s.schedule_date >= p_start_date
              AND s.schedule_date <= p_end_date
              AND (p_status IS NULL OR s.status = p_status)
        ), '[]'::jsonb),

        -- Active employees for dropdown
        'employees', COALESCE((
            SELECT jsonb_agg(
                jsonb_build_object(
                    'id', e.id,
                    'display_name', e.display_name,
                    'profiles', jsonb_build_object(
                        'full_name', p.full_name
                    )
                )
                ORDER BY e.display_name
            )
            FROM employees e
            LEFT JOIN profiles p ON p.id = e.id
            WHERE e.is_active = true
        ), '[]'::jsonb),

        -- Quick stats
        'stats', (
            SELECT jsonb_build_object(
                'total', COUNT(*),
                'pending', COUNT(*) FILTER (WHERE status = 'pending'),
                'confirmed', COUNT(*) FILTER (WHERE status = 'confirmed'),
                'cancellation_requested', COUNT(*) FILTER (WHERE status = 'cancellation_requested')
            )
            FROM schedules
            WHERE schedule_date >= p_start_date
              AND schedule_date <= p_end_date
        )
    ) INTO result;

    RETURN result;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_admin_schedules_page_data(DATE, DATE, TEXT) TO authenticated;

-- ============================================
-- SCHEDULE STATS RPC (OPTIMIZED)
-- ============================================
-- Single query for all schedule statistics

CREATE OR REPLACE FUNCTION get_schedule_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result JSONB;
    v_today DATE := CURRENT_DATE;
BEGIN
    SELECT jsonb_build_object(
        'pending', COUNT(*) FILTER (WHERE status = 'pending'),
        'cancellation_requested', COUNT(*) FILTER (WHERE status = 'cancellation_requested'),
        'today_schedules', COUNT(*) FILTER (WHERE schedule_date = v_today AND status != 'cancelled')
    )
    INTO result
    FROM schedules;

    RETURN result;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_schedule_stats() TO authenticated;

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON FUNCTION get_employee_dashboard_data(UUID) IS
    'Fetches all employee dashboard data in a single query for better performance';

COMMENT ON FUNCTION get_admin_schedules_page_data(DATE, DATE, TEXT) IS
    'Fetches admin schedules page data with employees and stats in a single query';

COMMENT ON FUNCTION get_schedule_stats() IS
    'Returns schedule statistics (pending, cancellation_requested, today) in a single query';
