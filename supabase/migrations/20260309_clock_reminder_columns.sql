-- Add columns to track clock-in/out reminder emails sent for schedules
ALTER TABLE schedules
  ADD COLUMN IF NOT EXISTS clock_in_reminder_sent BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS clock_out_reminder_sent BOOLEAN DEFAULT FALSE;

-- Index for efficient cron queries: today's confirmed schedules that haven't had reminders sent
CREATE INDEX IF NOT EXISTS idx_schedules_clock_reminder
  ON schedules (schedule_date, status)
  WHERE clock_in_reminder_sent = FALSE OR clock_out_reminder_sent = FALSE;
