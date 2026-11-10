-- Calendar Sync — Migration 2: RLS policies
--
-- Principle: calendar connections and tokens are PRIVATE to their owner. No
-- admin, scoped or super, may read another user's OAuth tokens or feed tokens.
--
-- Admins may read another user's *external events* only when that user has
-- opted in (calendar_sync_prefs.share_external_with_admin), and only within
-- their location scope (admin_can_view_employee).
--
-- Idempotent (DROP POLICY IF EXISTS / CREATE).

BEGIN;

-- =====================================================================
-- Helper: may the current admin see this user's external calendar?
-- =====================================================================

CREATE OR REPLACE FUNCTION public.admin_can_view_external_calendar(target uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT public.admin_can_view_employee(target)
     AND EXISTS (
       SELECT 1 FROM calendar_sync_prefs p
       WHERE p.user_id = target AND p.share_external_with_admin = true
     );
$$;

-- =====================================================================
-- calendar_connections — owner only. Tokens never leave the owner's rows.
-- =====================================================================

DROP POLICY IF EXISTS calendar_connections_own ON public.calendar_connections;
CREATE POLICY calendar_connections_own ON public.calendar_connections
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- =====================================================================
-- calendar_sync_prefs — owner manages; admins may READ the sharing flags of
-- employees in scope so the Employee Calendar page knows who opted in.
-- =====================================================================

DROP POLICY IF EXISTS calendar_sync_prefs_own ON public.calendar_sync_prefs;
CREATE POLICY calendar_sync_prefs_own ON public.calendar_sync_prefs
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS calendar_sync_prefs_admin_read ON public.calendar_sync_prefs;
CREATE POLICY calendar_sync_prefs_admin_read ON public.calendar_sync_prefs
  FOR SELECT
  USING (public.admin_can_view_employee(user_id));

-- =====================================================================
-- calendar_event_links — owner only (internal bookkeeping)
-- =====================================================================

DROP POLICY IF EXISTS calendar_event_links_own ON public.calendar_event_links;
CREATE POLICY calendar_event_links_own ON public.calendar_event_links
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- =====================================================================
-- calendar_external_events — owner always; admins only on opt-in + in scope
-- =====================================================================

DROP POLICY IF EXISTS calendar_external_events_own ON public.calendar_external_events;
CREATE POLICY calendar_external_events_own ON public.calendar_external_events
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS calendar_external_events_admin_read ON public.calendar_external_events;
CREATE POLICY calendar_external_events_admin_read ON public.calendar_external_events
  FOR SELECT
  USING (public.admin_can_view_external_calendar(user_id));

-- =====================================================================
-- calendar_feed_tokens — owner only. The ICS route uses the service role and
-- authenticates by token hash instead of a session.
-- =====================================================================

DROP POLICY IF EXISTS calendar_feed_tokens_own ON public.calendar_feed_tokens;
CREATE POLICY calendar_feed_tokens_own ON public.calendar_feed_tokens
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- =====================================================================
-- calendar_change_requests — employee sees own; admins see/resolve in scope
-- =====================================================================

DROP POLICY IF EXISTS calendar_change_requests_own ON public.calendar_change_requests;
CREATE POLICY calendar_change_requests_own ON public.calendar_change_requests
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS calendar_change_requests_admin_read ON public.calendar_change_requests;
CREATE POLICY calendar_change_requests_admin_read ON public.calendar_change_requests
  FOR SELECT
  USING (public.admin_can_view_employee(user_id));

DROP POLICY IF EXISTS calendar_change_requests_admin_update ON public.calendar_change_requests;
CREATE POLICY calendar_change_requests_admin_update ON public.calendar_change_requests
  FOR UPDATE
  USING (public.admin_can_view_employee(user_id))
  WITH CHECK (public.admin_can_view_employee(user_id));

COMMIT;
