-- Calendar Sync — Migration 1: schema
--
-- Adds per-user external calendar connections (Google / Microsoft), sync
-- preferences, an outbound event link table, an inbound event cache, and
-- secret ICS feed tokens.
--
-- Idempotent so it can be re-run safely.

BEGIN;

-- =====================================================================
-- 1. Connections — one row per (user, provider)
-- =====================================================================
-- access_token / refresh_token are stored ENCRYPTED (AES-256-GCM) by the
-- application layer; see src/lib/calendar/crypto.ts. Never store plaintext.

CREATE TABLE IF NOT EXISTS public.calendar_connections (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider              text NOT NULL CHECK (provider IN ('google', 'microsoft')),
  provider_account_id   text,
  provider_account_email text,

  access_token_enc      text,
  refresh_token_enc     text,
  token_expires_at      timestamptz,
  scopes                text,

  -- The dedicated "PlayFunia" calendar we create inside their account.
  target_calendar_id    text,
  target_calendar_name  text NOT NULL DEFAULT 'PlayFunia',

  -- Incremental sync bookkeeping (Google syncToken / Graph deltaLink)
  sync_token            text,

  -- Push-notification channel bookkeeping
  watch_channel_id      text,
  watch_resource_id     text,
  watch_secret          text,
  watch_expires_at      timestamptz,

  status                text NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'needs_reauth', 'revoked', 'error')),
  last_synced_at        timestamptz,
  last_error            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_calendar_connections_user
  ON public.calendar_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_calendar_connections_channel
  ON public.calendar_connections(watch_channel_id);
CREATE INDEX IF NOT EXISTS idx_calendar_connections_watch_exp
  ON public.calendar_connections(watch_expires_at)
  WHERE status = 'active';

-- =====================================================================
-- 2. Per-user sync preferences
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.calendar_sync_prefs (
  user_id            uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  sync_shifts        boolean NOT NULL DEFAULT true,
  sync_tasks         boolean NOT NULL DEFAULT true,
  sync_events        boolean NOT NULL DEFAULT true,
  sync_birthdays     boolean NOT NULL DEFAULT false,
  sync_onboarding    boolean NOT NULL DEFAULT false,
  -- Whether this user's PERSONAL external events are visible to admins on the
  -- Employee Calendar page. Opt-in, and even then admins may only see busy
  -- blocks unless share_external_details is also true.
  share_external_with_admin boolean NOT NULL DEFAULT false,
  share_external_details    boolean NOT NULL DEFAULT false,
  reminder_minutes   integer NOT NULL DEFAULT 60 CHECK (reminder_minutes BETWEEN 0 AND 10080),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- =====================================================================
-- 3. Outbound links — our entity -> the event we created in their calendar
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.calendar_event_links (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id     uuid NOT NULL REFERENCES public.calendar_connections(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source_type       text NOT NULL CHECK (source_type IN ('schedule', 'task', 'event', 'birthday', 'onboarding')),
  source_id         text NOT NULL,
  external_event_id text NOT NULL,
  -- Hash of the payload we last pushed, so unchanged items are skipped.
  content_hash      text,
  deleted_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  UNIQUE (connection_id, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_calendar_event_links_ext
  ON public.calendar_event_links(connection_id, external_event_id);
CREATE INDEX IF NOT EXISTS idx_calendar_event_links_user
  ON public.calendar_event_links(user_id);

-- =====================================================================
-- 4. Inbound cache — events pulled FROM their external calendars
-- =====================================================================
-- Powers "My Calendar" (unified view) and the admin Employee Calendar.
-- is_playfunia marks events that originated from us, so the UI can avoid
-- showing a shift twice.

CREATE TABLE IF NOT EXISTS public.calendar_external_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id     uuid NOT NULL REFERENCES public.calendar_connections(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider          text NOT NULL,
  external_id       text NOT NULL,
  calendar_id       text,
  title             text,
  description       text,
  location          text,
  starts_at         timestamptz,
  ends_at           timestamptz,
  all_day           boolean NOT NULL DEFAULT false,
  transparency      text,              -- 'opaque' (busy) | 'transparent' (free)
  status            text,              -- confirmed | tentative | cancelled
  organizer_email   text,
  html_link         text,
  is_playfunia      boolean NOT NULL DEFAULT false,
  updated_at        timestamptz NOT NULL DEFAULT now(),

  UNIQUE (connection_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_calendar_external_events_user_time
  ON public.calendar_external_events(user_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_calendar_external_events_conn
  ON public.calendar_external_events(connection_id);

-- =====================================================================
-- 5. ICS feed tokens (Apple Calendar / Outlook / anything else)
-- =====================================================================
-- Only the SHA-256 hash of the token is stored; the raw token lives in the
-- webcal URL the user copies. Lookup is by hash.

CREATE TABLE IF NOT EXISTS public.calendar_feed_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  label       text,
  last_used_at timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calendar_feed_tokens_user
  ON public.calendar_feed_tokens(user_id) WHERE revoked_at IS NULL;

-- =====================================================================
-- 6. Inbound change requests raised by edits made in the external calendar
-- =====================================================================
-- Two-way sync rule: employees may not silently rewrite a shift. Deleting or
-- moving a synced shift event in Google/Outlook files a request for an admin,
-- mirroring the existing schedules.cancellation_requested flow.

CREATE TABLE IF NOT EXISTS public.calendar_change_requests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  connection_id  uuid REFERENCES public.calendar_connections(id) ON DELETE SET NULL,
  source_type    text NOT NULL,
  source_id      text NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('cancel', 'reschedule')),
  requested_start timestamptz,
  requested_end   timestamptz,
  note           text,
  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'approved', 'rejected', 'superseded')),
  resolved_at    timestamptz,
  resolved_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calendar_change_requests_pending
  ON public.calendar_change_requests(status, created_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_calendar_change_requests_source
  ON public.calendar_change_requests(source_type, source_id);

-- =====================================================================
-- 7. updated_at triggers
-- =====================================================================

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_calendar_connections_touch ON public.calendar_connections;
CREATE TRIGGER trg_calendar_connections_touch
  BEFORE UPDATE ON public.calendar_connections
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_calendar_sync_prefs_touch ON public.calendar_sync_prefs;
CREATE TRIGGER trg_calendar_sync_prefs_touch
  BEFORE UPDATE ON public.calendar_sync_prefs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_calendar_event_links_touch ON public.calendar_event_links;
CREATE TRIGGER trg_calendar_event_links_touch
  BEFORE UPDATE ON public.calendar_event_links
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =====================================================================
-- 8. Enable RLS (policies live in migration 2)
-- =====================================================================

ALTER TABLE public.calendar_connections     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_sync_prefs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_event_links     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_external_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_feed_tokens     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_change_requests ENABLE ROW LEVEL SECURITY;

COMMIT;
