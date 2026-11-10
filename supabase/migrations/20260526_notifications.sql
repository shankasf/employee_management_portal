-- In-app notifications: one row per recipient. The notifications tab in the
-- admin and employee portals reads these; the birthday cron and (later) other
-- producers write them via the service role.

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- recipient (= profiles.id)
  type TEXT NOT NULL,            -- 'birthday', 'system', ...
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,                     -- optional in-app link
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  dedupe_key TEXT,               -- set by idempotent producers (e.g. birthday cron)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications(user_id) WHERE is_read = FALSE;

-- Lets producers use ON CONFLICT (user_id, dedupe_key) DO NOTHING so re-runs
-- don't duplicate. NULL dedupe_keys stay distinct (Postgres default), so rows
-- without a key never collide.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_notifications_dedupe
  ON notifications(user_id, dedupe_key);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Recipients can read their own notifications.
DROP POLICY IF EXISTS "Users read own notifications" ON notifications;
CREATE POLICY "Users read own notifications"
  ON notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Recipients can mark their own notifications read.
DROP POLICY IF EXISTS "Users update own notifications" ON notifications;
CREATE POLICY "Users update own notifications"
  ON notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- No INSERT/DELETE policy: only the service role (cron / server) writes rows.
