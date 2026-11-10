-- SMS compliance: unsubscribe registry + comprehensive send logging
--
-- Motivation: Twilio Error 21610 ("Attempt to send to unsubscribed recipient")
-- was returned for 47 messages. Once a recipient texts STOP, Twilio permanently
-- blocks further SMS to that number until they text START. We must (a) keep a
-- clean, authoritative copy of that opt-out state in our own DB, (b) never
-- attempt to send to an opted-out number, and (c) log every send attempt so the
-- failures are visible and auditable.

-- ============================================================
-- sms_unsubscribes — authoritative opt-out registry
-- ============================================================
-- One row per phone number that has ever opted out. `active = true` means the
-- number is currently unsubscribed and must NOT be texted. A START/UNSTOP reply
-- flips `active = false` (we keep the row for audit history rather than deleting).
CREATE TABLE IF NOT EXISTS sms_unsubscribes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL UNIQUE,                 -- E.164, e.g. +15551234567
  active boolean NOT NULL DEFAULT true,       -- true = currently opted out
  reason text,                                -- free text / keyword that triggered it
  source text NOT NULL,                        -- twilio_21610 | inbound_stop | inbound_start | manual
  last_message_sid text,                       -- Twilio SID associated with the event, if any
  unsubscribed_at timestamptz DEFAULT now(),
  resubscribed_at timestamptz,                 -- set when the number opts back in
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sms_unsubscribes_phone_active
  ON sms_unsubscribes (phone, active);

-- ============================================================
-- sms_logs — every send attempt, success or failure
-- ============================================================
CREATE TABLE IF NOT EXISTS sms_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,                          -- formatted (E.164) recipient, or raw if unparseable
  message_type text,                            -- schedule_assigned, task_assigned, clock_in_reminder, etc.
  body text,                                    -- the message body that was (or would have been) sent
  status text NOT NULL CHECK (status IN (
    'sent', 'failed', 'skipped_unsubscribed', 'invalid_number'
  )),
  twilio_sid text,                              -- message SID on success
  error_code text,                              -- Twilio error code, e.g. 21610
  error_message text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sms_logs_created_at ON sms_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_logs_phone ON sms_logs (phone);
CREATE INDEX IF NOT EXISTS idx_sms_logs_status ON sms_logs (status);
CREATE INDEX IF NOT EXISTS idx_sms_logs_error_code ON sms_logs (error_code);

-- ============================================================
-- RLS — admins may read, service role writes (bypasses RLS)
-- ============================================================
ALTER TABLE sms_unsubscribes ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_logs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Admins can view sms unsubscribes" ON sms_unsubscribes
    FOR SELECT USING (
      EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can view sms logs" ON sms_logs
    FOR SELECT USING (
      EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- Auto-cleanup helper: keep 180 days of send logs
-- (unsubscribes are kept indefinitely — they are compliance records)
-- ============================================================
CREATE OR REPLACE FUNCTION cleanup_old_sms_logs() RETURNS void AS $$
BEGIN
  DELETE FROM sms_logs WHERE created_at < now() - interval '180 days';
END;
$$ LANGUAGE plpgsql;
