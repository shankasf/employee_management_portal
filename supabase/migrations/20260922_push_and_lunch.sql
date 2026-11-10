-- Browser push reminders + Start/End Lunch tracking
-- Date: 2026-09-22
--
-- 1. push_subscriptions: one row per browser/device an employee turned
--    reminders on from. Written by the employee (RLS: own rows only), read by
--    the cron via the service role.
-- 2. attendance_logs.break_start: set while the employee is on lunch; cleared
--    (and its minutes folded into break_minutes) when lunch ends.
--    attendance_logs.break_reminder_sent_at: stops the 30-minute lunch reminder
--    from repeating for the same break.
-- 3. schedules.shift_start_push_sent / shift_end_push_sent: "your shift is
--    starting / ending" nudges, sent once per schedule.
-- 4. get_employee_dashboard_data: expose break_start/break_minutes on
--    open_attendance so the dashboard can render the lunch state.

BEGIN;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_success_at TIMESTAMPTZ,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own push subscriptions" ON push_subscriptions;
CREATE POLICY "Users manage own push subscriptions"
  ON push_subscriptions FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON push_subscriptions TO authenticated;

ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS break_start TIMESTAMPTZ;
ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS break_reminder_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_attendance_logs_on_break
  ON attendance_logs(break_start) WHERE break_start IS NOT NULL AND clock_out IS NULL;

ALTER TABLE schedules ADD COLUMN IF NOT EXISTS shift_start_push_sent BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS shift_end_push_sent BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.get_employee_dashboard_data(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    result JSONB;
    v_today DATE := (NOW() AT TIME ZONE 'America/New_York')::DATE;
BEGIN
    SELECT jsonb_build_object(
        'open_attendance', (
            SELECT jsonb_build_object(
                'id', id, 'clock_in', clock_in,
                'break_start', break_start, 'break_minutes', break_minutes
            )
            FROM attendance_logs WHERE employee_id = p_user_id AND clock_out IS NULL
            ORDER BY clock_in DESC LIMIT 1
        ),
        'today_tasks', COALESCE((
            SELECT jsonb_agg(task_row)
            FROM (
                SELECT jsonb_build_object(
                    'id', ti.id, 'task_id', ti.task_id, 'status', ti.status,
                    'title', t.title, 'description', t.description, 'location', t.location,
                    'cutoff_time', t.cutoff_time, 'requires_photo', t.requires_photo,
                    'requires_video', t.requires_video, 'requires_notes', t.requires_notes
                ) as task_row
                FROM task_instances ti JOIN tasks t ON t.id = ti.task_id
                WHERE ti.employee_id = p_user_id AND ti.scheduled_date = v_today
                LIMIT 10
            ) sub
        ), '[]'::jsonb),
        'upcoming_events', COALESCE((
            SELECT jsonb_agg(event_row)
            FROM (
                SELECT jsonb_build_object(
                    'id', e.id, 'title', e.title, 'start_time', e.start_time,
                    'end_time', e.end_time, 'room', e.room, 'my_role', esa.role
                ) as event_row
                FROM events e JOIN event_staff_assignments esa ON esa.event_id = e.id
                WHERE esa.employee_id = p_user_id AND e.start_time >= NOW()
                ORDER BY e.start_time ASC
                LIMIT 5
            ) sub
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
$function$;

COMMIT;

-- Auto clock-out at end of day must also close an open lunch, otherwise the
-- hours trigger ignores it and break_start dangles into the next day.
CREATE OR REPLACE FUNCTION public.auto_clock_out_open_shifts()
 RETURNS TABLE(id uuid, employee_id uuid, clock_in timestamp with time zone, clock_out timestamp with time zone, total_hours numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    RETURN QUERY
    UPDATE public.attendance_logs a
    SET clock_out = sub.ny_eod,
        auto_clocked_out = true,
        break_minutes = CASE
            WHEN a.break_start IS NOT NULL
            THEN COALESCE(a.break_minutes, 0)
                 + GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (sub.ny_eod - a.break_start)) / 60))::int
            ELSE a.break_minutes
        END,
        break_start = NULL,
        break_reminder_sent_at = NULL
    FROM (
        SELECT al.id,
            ((((al.clock_in AT TIME ZONE 'America/New_York')::date + 1)::timestamp
                AT TIME ZONE 'America/New_York') - interval '1 second') AS ny_eod
        FROM public.attendance_logs al
        WHERE al.clock_out IS NULL
    ) sub
    WHERE a.id = sub.id
      AND sub.ny_eod < now()
    RETURNING a.id, a.employee_id, a.clock_in, a.clock_out, a.total_hours;
END;
$function$;
