-- Scoped Admin — Migration 2: helpers, RLS, triggers, scope-aware RPCs
-- Full admins short-circuit every scope predicate (NOT is_scoped_admin() = true),
-- so their behavior is unchanged. Idempotent (CREATE OR REPLACE / DROP IF EXISTS).

BEGIN;

-- =====================================================================
-- 1. Helper functions (SECURITY DEFINER → bypass RLS, no recursion)
-- =====================================================================

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND is_super_admin = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_scoped_admin()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'admin' AND admin_scoped = true
  );
$$;

CREATE OR REPLACE FUNCTION public.admin_managed_business_ids()
RETURNS integer[] LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT COALESCE(array_agg(business_id), ARRAY[]::integer[])
  FROM admin_businesses
  WHERE admin_id = auth.uid();
$$;

-- True when the current user is an admin AND (full admin OR the given employee
-- is tagged to one of the scoped admin's managed businesses).
CREATE OR REPLACE FUNCTION public.admin_can_view_employee(emp uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT public.is_admin() AND (
    NOT public.is_scoped_admin()
    OR EXISTS (
      SELECT 1 FROM employee_businesses eb
      WHERE eb.employee_id = emp
        AND eb.business_id = ANY (public.admin_managed_business_ids())
    )
  );
$$;

-- =====================================================================
-- 2. Scope-aware RLS on employee-keyed tables
--    (admin branches only; employee-self policies untouched)
-- =====================================================================

-- ---- employees (row key: id) ----
DROP POLICY IF EXISTS "Admins can view all employees" ON employees;
CREATE POLICY "Admins can view all employees" ON employees
  FOR SELECT USING (public.admin_can_view_employee(id));

DROP POLICY IF EXISTS "Admins can update employees" ON employees;
CREATE POLICY "Admins can update employees" ON employees
  FOR UPDATE USING (public.admin_can_view_employee(id))
  WITH CHECK (public.admin_can_view_employee(id));

DROP POLICY IF EXISTS "Admins can delete employees" ON employees;
CREATE POLICY "Admins can delete employees" ON employees
  FOR DELETE USING (public.admin_can_view_employee(id));

DROP POLICY IF EXISTS "Admins can insert employees" ON employees;
CREATE POLICY "Admins can insert employees" ON employees
  FOR INSERT WITH CHECK (public.is_admin() AND NOT public.is_scoped_admin());

-- ---- attendance_logs (row key: employee_id) ----
DROP POLICY IF EXISTS "Admins can view all attendance" ON attendance_logs;
CREATE POLICY "Admins can view all attendance" ON attendance_logs
  FOR SELECT USING (public.admin_can_view_employee(employee_id));

DROP POLICY IF EXISTS "Admins can update attendance" ON attendance_logs;
CREATE POLICY "Admins can update attendance" ON attendance_logs
  FOR UPDATE USING (public.admin_can_view_employee(employee_id))
  WITH CHECK (public.admin_can_view_employee(employee_id));

DROP POLICY IF EXISTS "Admins can delete attendance" ON attendance_logs;
CREATE POLICY "Admins can delete attendance" ON attendance_logs
  FOR DELETE USING (public.admin_can_view_employee(employee_id));

-- ---- schedules (row key: employee_id) ----
DROP POLICY IF EXISTS "Admins can view all schedules" ON schedules;
CREATE POLICY "Admins can view all schedules" ON schedules
  FOR SELECT USING (public.admin_can_view_employee(employee_id));

DROP POLICY IF EXISTS "Admins can create schedules" ON schedules;
CREATE POLICY "Admins can create schedules" ON schedules
  FOR INSERT WITH CHECK (public.admin_can_view_employee(employee_id));

DROP POLICY IF EXISTS "Admins can update all schedules" ON schedules;
CREATE POLICY "Admins can update all schedules" ON schedules
  FOR UPDATE USING (public.admin_can_view_employee(employee_id))
  WITH CHECK (public.admin_can_view_employee(employee_id));

DROP POLICY IF EXISTS "Admins can delete schedules" ON schedules;
CREATE POLICY "Admins can delete schedules" ON schedules
  FOR DELETE USING (public.admin_can_view_employee(employee_id));

-- ---- task_instances (row key: employee_id) ----
DROP POLICY IF EXISTS "Admins can view all task instances" ON task_instances;
CREATE POLICY "Admins can view all task instances" ON task_instances
  FOR SELECT USING (public.admin_can_view_employee(employee_id));

DROP POLICY IF EXISTS "Admins can create task instances" ON task_instances;
CREATE POLICY "Admins can create task instances" ON task_instances
  FOR INSERT WITH CHECK (public.admin_can_view_employee(employee_id));

DROP POLICY IF EXISTS "Admins can update task instances" ON task_instances;
CREATE POLICY "Admins can update task instances" ON task_instances
  FOR UPDATE USING (public.admin_can_view_employee(employee_id))
  WITH CHECK (public.admin_can_view_employee(employee_id));

DROP POLICY IF EXISTS "Admins can delete task instances" ON task_instances;
CREATE POLICY "Admins can delete task instances" ON task_instances
  FOR DELETE USING (public.admin_can_view_employee(employee_id));

-- ---- onboarding_progress (row key: employee_id; keep self-access) ----
DROP POLICY IF EXISTS onboarding_progress_select ON onboarding_progress;
CREATE POLICY onboarding_progress_select ON onboarding_progress
  FOR SELECT TO authenticated
  USING (employee_id = auth.uid() OR public.admin_can_view_employee(employee_id));

DROP POLICY IF EXISTS onboarding_progress_admin_delete ON onboarding_progress;
CREATE POLICY onboarding_progress_admin_delete ON onboarding_progress
  FOR DELETE TO authenticated
  USING (public.admin_can_view_employee(employee_id));

-- ---- profiles (row key: id; keep self-access) ----
DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;
CREATE POLICY "Admins can view all profiles" ON profiles
  FOR SELECT USING (public.admin_can_view_employee(id));

DROP POLICY IF EXISTS "Admins can update all profiles" ON profiles;
CREATE POLICY "Admins can update all profiles" ON profiles
  FOR UPDATE USING (public.admin_can_view_employee(id))
  WITH CHECK (public.admin_can_view_employee(id));

DROP POLICY IF EXISTS "Admins can insert profiles" ON profiles;
CREATE POLICY "Admins can insert profiles" ON profiles
  FOR INSERT WITH CHECK (public.is_admin() AND NOT public.is_scoped_admin());

-- ---- employee_businesses (row key: employee_id) ----
DROP POLICY IF EXISTS "Users can read own business assignments" ON employee_businesses;
CREATE POLICY "Users can read own business assignments" ON employee_businesses
  FOR SELECT TO authenticated
  USING (employee_id = auth.uid() OR public.admin_can_view_employee(employee_id));

-- Scoped admins may only manage tags for in-scope employees and only within
-- their own managed businesses.
DROP POLICY IF EXISTS "Admins can manage business assignments" ON employee_businesses;
CREATE POLICY "Admins can manage business assignments" ON employee_businesses
  FOR ALL TO authenticated
  USING (
    public.is_admin() AND (
      NOT public.is_scoped_admin()
      OR (public.admin_can_view_employee(employee_id)
          AND business_id = ANY (public.admin_managed_business_ids()))
    )
  )
  WITH CHECK (
    public.is_admin() AND (
      NOT public.is_scoped_admin()
      OR (public.admin_can_view_employee(employee_id)
          AND business_id = ANY (public.admin_managed_business_ids()))
    )
  );

-- =====================================================================
-- 3. admin_businesses RLS (super-admin managed)
-- =====================================================================
DROP POLICY IF EXISTS admin_businesses_select ON admin_businesses;
CREATE POLICY admin_businesses_select ON admin_businesses
  FOR SELECT TO authenticated
  USING (admin_id = auth.uid() OR public.is_super_admin());

DROP POLICY IF EXISTS admin_businesses_write ON admin_businesses;
CREATE POLICY admin_businesses_write ON admin_businesses
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- =====================================================================
-- 4. Privilege-escalation guard on profiles (role + scope flags)
--    Service-role writes (auth.uid() IS NULL) bypass — API route enforces there.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.enforce_profile_privileges()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF (NEW.is_super_admin OR NEW.admin_scoped) AND NOT public.is_super_admin() THEN
      RAISE EXCEPTION 'Only super admins can create admins with scope settings';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF public.is_scoped_admin() THEN
    IF NEW.role IS DISTINCT FROM OLD.role
       OR NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin
       OR NEW.admin_scoped IS DISTINCT FROM OLD.admin_scoped THEN
      RAISE EXCEPTION 'Scoped admins cannot change roles or permissions';
    END IF;
  END IF;

  IF (NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin
      OR NEW.admin_scoped IS DISTINCT FROM OLD.admin_scoped)
     AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only super admins can change admin scope settings';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_profile_privileges ON profiles;
CREATE TRIGGER trg_enforce_profile_privileges
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_profile_privileges();

-- =====================================================================
-- 5. Scope-aware aggregation RPCs
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_admin_dashboard_stats()
RETURNS TABLE(active_employees bigint, clocked_in_today bigint, tasks_completed_today bigint, tasks_pending_today bigint, events_today bigint, events_this_week bigint, schedules_pending_confirmation bigint, schedules_cancellation_requested bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_today DATE := (NOW() AT TIME ZONE 'America/New_York')::DATE;
  v_now TIMESTAMPTZ := NOW();
  v_week_end TIMESTAMPTZ := v_now + INTERVAL '7 days';
  v_scoped boolean := public.is_scoped_admin();
  v_biz integer[] := public.admin_managed_business_ids();
BEGIN
  RETURN QUERY SELECT
    (SELECT COUNT(*) FROM employees e WHERE e.is_active = TRUE
       AND (NOT v_scoped OR EXISTS (SELECT 1 FROM employee_businesses eb WHERE eb.employee_id = e.id AND eb.business_id = ANY(v_biz)))),
    (SELECT COUNT(*) FROM attendance_logs a WHERE DATE(a.clock_in AT TIME ZONE 'America/New_York') = v_today AND a.clock_out IS NULL
       AND (NOT v_scoped OR EXISTS (SELECT 1 FROM employee_businesses eb WHERE eb.employee_id = a.employee_id AND eb.business_id = ANY(v_biz)))),
    (SELECT COUNT(*) FROM task_instances t WHERE t.scheduled_date = v_today AND t.status = 'completed'
       AND (NOT v_scoped OR EXISTS (SELECT 1 FROM employee_businesses eb WHERE eb.employee_id = t.employee_id AND eb.business_id = ANY(v_biz)))),
    (SELECT COUNT(*) FROM task_instances t WHERE t.scheduled_date = v_today AND t.status = 'pending'
       AND (NOT v_scoped OR EXISTS (SELECT 1 FROM employee_businesses eb WHERE eb.employee_id = t.employee_id AND eb.business_id = ANY(v_biz)))),
    (SELECT CASE WHEN v_scoped THEN 0::bigint ELSE COUNT(*) END FROM events WHERE DATE(start_time AT TIME ZONE 'America/New_York') = v_today),
    (SELECT CASE WHEN v_scoped THEN 0::bigint ELSE COUNT(*) END FROM events WHERE start_time >= v_now AND start_time < v_week_end),
    (SELECT COUNT(*) FROM schedules s WHERE s.status = 'pending'
       AND (NOT v_scoped OR EXISTS (SELECT 1 FROM employee_businesses eb WHERE eb.employee_id = s.employee_id AND eb.business_id = ANY(v_biz)))),
    (SELECT COUNT(*) FROM schedules s WHERE s.status = 'cancellation_requested'
       AND (NOT v_scoped OR EXISTS (SELECT 1 FROM employee_businesses eb WHERE eb.employee_id = s.employee_id AND eb.business_id = ANY(v_biz))));
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_schedules_page_data(p_start_date date DEFAULT CURRENT_DATE, p_end_date date DEFAULT (CURRENT_DATE + '30 days'::interval), p_status text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
    result JSONB;
    v_scoped boolean := public.is_scoped_admin();
    v_biz integer[] := public.admin_managed_business_ids();
BEGIN
    SELECT jsonb_build_object(
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
              AND (NOT v_scoped OR EXISTS (SELECT 1 FROM employee_businesses eb WHERE eb.employee_id = s.employee_id AND eb.business_id = ANY(v_biz)))
        ), '[]'::jsonb),

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
              AND (NOT v_scoped OR EXISTS (SELECT 1 FROM employee_businesses eb WHERE eb.employee_id = e.id AND eb.business_id = ANY(v_biz)))
        ), '[]'::jsonb),

        'stats', (
            SELECT jsonb_build_object(
                'total', COUNT(*),
                'pending', COUNT(*) FILTER (WHERE s2.status = 'pending'),
                'confirmed', COUNT(*) FILTER (WHERE s2.status = 'confirmed'),
                'cancellation_requested', COUNT(*) FILTER (WHERE s2.status = 'cancellation_requested')
            )
            FROM schedules s2
            WHERE s2.schedule_date >= p_start_date
              AND s2.schedule_date <= p_end_date
              AND (NOT v_scoped OR EXISTS (SELECT 1 FROM employee_businesses eb WHERE eb.employee_id = s2.employee_id AND eb.business_id = ANY(v_biz)))
        )
    ) INTO result;

    RETURN result;
END;
$function$;

COMMIT;
