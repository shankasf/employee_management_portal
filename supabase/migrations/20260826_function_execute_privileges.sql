-- 20260826_function_execute_privileges.sql
--
-- Postgres grants EXECUTE on new functions to PUBLIC by default, and PostgREST
-- exposes every function in `public` as an RPC endpoint. SECURITY DEFINER
-- functions run as their owner, so they bypass RLS *and* table grants - the
-- table lockdown in 20260826_security_lockdown.sql did not cover them.
--
-- Verified against the live API with this project's own anon key before writing:
--   POST /rest/v1/rpc/get_admin_dashboard_stats  -> 200, full org stats
--   POST /rest/v1/rpc/get_schedule_stats         -> 200 {"pending":111,...}
--   POST /rest/v1/rpc/auto_clock_out_open_shifts -> 200, and it MUTATES:
--        an anonymous caller could force-clock-out every open shift
--
-- Unlike the Playfunia project, this app calls RPCs from the browser under a
-- user session, so `authenticated` keeps EXECUTE on the functions the UI uses.
-- Only anon loses everything.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Baseline: nothing in this schema is callable by PUBLIC or anon. Grant the
--    app's own roles back explicitly below.
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d
                      WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Hand `authenticated` back exactly what the app calls.
--
--    Group A - RPCs invoked from the browser (grep for `.rpc(` in src/).
--    Group B - helpers referenced inside RLS policy expressions. Policy
--              expressions are evaluated as the invoking role, so the caller
--              needs EXECUTE on these or every policy using them errors out.
--
--    Deliberately NOT re-granted, so they stay service_role-only:
--      auto_clock_out_open_shifts - mutating; only app/api/cron/auto-clock-out
--      cleanup_old_task_media     - destructive; cron only
--      handle_new_user            - auth trigger; triggers do not need EXECUTE
--      enforce_profile_privileges - table trigger; same
--      admin_cancel_schedule, admin_clear_device, approve_schedule_cancellation,
--      check_device, get_employee_shift_info, get_my_schedules,
--      cleanup_old_cron_logs, cleanup_old_sms_logs - no caller in the codebase
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  fn text;
  wanted text[] := ARRAY[
    -- Group A: called from the browser
    'register_device',
    'get_admin_dashboard_stats',
    'get_employee_dashboard_data',
    'get_admin_schedules_page_data',
    'get_schedule_stats',
    'confirm_schedule',
    'request_schedule_cancellation',
    'get_my_upcoming_events',
    'get_open_attendance',
    'clock_in',
    'clock_out',
    'get_today_tasks',
    'complete_task',
    -- Group B: used inside RLS policies
    'is_admin',
    'is_scoped_admin',
    'is_super_admin',
    'admin_can_view_employee',
    'admin_managed_business_ids'
  ];
  r record;
BEGIN
  FOREACH fn IN ARRAY wanted LOOP
    FOR r IN
      SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = fn
    LOOP
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    END LOOP;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3. The admin-only reporting RPCs used is_scoped_admin()/admin_managed_business_ids()
--    to *scope* their results but never checked that the caller is an admin at
--    all - which is why anon got the whole dashboard back. Add the missing
--    authorization check. Bodies are otherwise untouched.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  def text;
  guard text;
  marker text;
  pos int;
BEGIN
  FOR r IN
    SELECT p.oid AS oid, p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('get_admin_dashboard_stats',
                        'get_schedule_stats',
                        'get_admin_schedules_page_data')
  LOOP
    def := pg_get_functiondef(r.oid);

    IF position('Admin privileges required' IN def) > 0 THEN
      CONTINUE; -- already guarded, keep this migration re-runnable
    END IF;

    guard := E'\n  IF NOT public.is_admin() THEN\n'
          || E'    RAISE EXCEPTION ''Admin privileges required'' USING ERRCODE = ''42501'';\n'
          || E'  END IF;\n';

    -- Inject immediately after the body's opening BEGIN, which is the first
    -- line that is exactly "BEGIN" in these three plpgsql bodies.
    marker := E'\nBEGIN\n';
    pos := position(marker IN def);
    IF pos = 0 THEN
      RAISE EXCEPTION 'Could not locate body BEGIN for %', r.proname;
    END IF;

    def := overlay(def placing (marker || guard) from pos for length(marker));
    EXECUTE def;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Stop the PUBLIC default from reinstating this on the next function.
-- ---------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon;

COMMIT;
