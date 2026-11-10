-- 20260826_security_lockdown.sql
--
-- Every table in this project already had RLS enabled, and almost every policy
-- is correctly keyed on auth.uid(). This migration closes the exceptions that
-- were verified to be live holes, plus the standard advisor findings.
--
-- Verified with the project's own anon key before writing this:
--   GET /rest/v1/clock_debug_logs  -> 200 with real rows  (13.6k rows leaked)
--   POST /rest/v1/activity_logs    -> 23502 (not-null), i.e. RLS accepted it
--   every other table              -> 200 []
--
-- Access model: browser and route handlers use the user session (authenticated);
-- cron jobs, logging helpers and admin mutations use SUPABASE_SERVICE_ROLE_KEY,
-- which bypasses RLS. Nothing legitimately runs as anon against public tables.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Policies written without a TO clause default to role "public", which
--    includes anon. These three were named for the service role but were in
--    fact open to the internet.
-- ---------------------------------------------------------------------------

-- clock_debug_logs: was ALL / USING (true) / WITH CHECK (true) to public.
-- Written by app/api/clock-debug-log/route.ts through the service client only.
DROP POLICY IF EXISTS "Service role full access" ON public.clock_debug_logs;
CREATE POLICY "Service role full access" ON public.clock_debug_logs
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Admins can view clock debug logs" ON public.clock_debug_logs;
CREATE POLICY "Admins can view clock debug logs" ON public.clock_debug_logs
  FOR SELECT TO authenticated USING (is_admin());

-- activity_logs: anon could forge audit entries. Written by lib/activity-log.ts
-- and app/api/activity-log/route.ts through the admin (service role) client.
DROP POLICY IF EXISTS "Service role can insert activity logs" ON public.activity_logs;
CREATE POLICY "Service role can insert activity logs" ON public.activity_logs
  FOR INSERT TO service_role WITH CHECK (true);

-- usage_logs: same shape, written by app/api/usage-log/route.ts via adminClient.
DROP POLICY IF EXISTS "Service role can insert usage logs" ON public.usage_logs;
CREATE POLICY "Service role can insert usage logs" ON public.usage_logs
  FOR INSERT TO service_role WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 2. The remaining "public"-role policies all gate on auth.uid() / is_admin(),
--    so anon already gets zero rows from them. Re-target them at authenticated
--    anyway so the role list states the intent and anon stops being evaluated.
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record; v_cmd text; body text; targets jsonb;
BEGIN
  -- Snapshot first: the loop body rewrites pg_policy, so it must not iterate
  -- a live catalog cursor.
  SELECT coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) INTO targets
  FROM (SELECT tablename, policyname, cmd, qual, with_check
        FROM pg_policies
        WHERE schemaname = 'public' AND roles::text = '{public}') p;

  FOR r IN SELECT * FROM jsonb_to_recordset(targets)
             AS x(tablename text, policyname text, cmd text,
                  qual text, with_check text)
  LOOP
    v_cmd := r.cmd;
    body := '';
    IF r.qual IS NOT NULL THEN
      body := body || format(' USING (%s)', r.qual);
    END IF;
    IF r.with_check IS NOT NULL THEN
      body := body || format(' WITH CHECK (%s)', r.with_check);
    END IF;
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR %s TO authenticated%s',
                   r.policyname, r.tablename, v_cmd, body);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Table privileges. anon has no policy anywhere that can return a row, so
--    it needs no grants at all - and TRUNCATE, which anon held on all 30
--    tables, is not subject to RLS in the first place.
-- ---------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;

-- employee_recent_transactions is deliberately a security-definer view: it
-- self-filters on handled_by_employee = auth.uid() to let an employee see their
-- own transactions past the admin-only RLS on public.transactions. Leaving the
-- definer semantics intact but taking anon off it (auth.uid() is null for anon,
-- so it returned nothing anyway).
REVOKE ALL ON public.employee_recent_transactions FROM anon;

-- ---------------------------------------------------------------------------
-- 4. SECURITY DEFINER functions with a mutable search_path can be hijacked by
--    a caller-controlled schema - and this project has 19 of them, including
--    is_admin(), clock_in() and register_device().
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
      AND (p.proconfig IS NULL
           OR NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c
                          WHERE c LIKE 'search_path=%'))
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, extensions, pg_temp', r.sig);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Storage. "Anyone can view policy media" carried no auth predicate at all,
--    so anon could enumerate the whole bucket through storage.objects. Policy
--    strips are only ever shown to signed-in staff.
--    NOTE: the policy-media, profile-pictures and onboarding-content BUCKETS
--    are still flagged public, so their objects remain fetchable by anyone
--    holding an object URL. Closing that needs the client render paths to move
--    to getSignedStorageUrl() first - see the handover notes.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can view policy media" ON storage.objects;
CREATE POLICY "Authenticated can view policy media" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'policy-media');

COMMIT;
