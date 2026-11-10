-- Create cron_logs table for comprehensive cron job logging
CREATE TABLE IF NOT EXISTS cron_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cron_name text NOT NULL,
  run_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('success', 'error', 'partial')),
  summary text,
  details jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

-- Index for querying by cron name and date
CREATE INDEX idx_cron_logs_name_date ON cron_logs (cron_name, run_date DESC);

-- Auto-cleanup: keep only last 90 days of logs
-- (can be called periodically or via a cron)
CREATE OR REPLACE FUNCTION cleanup_old_cron_logs() RETURNS void AS $$
BEGIN
  DELETE FROM cron_logs WHERE created_at < now() - interval '90 days';
END;
$$ LANGUAGE plpgsql;

-- RLS: only service role can read/write
ALTER TABLE cron_logs ENABLE ROW LEVEL SECURITY;

-- Allow admins to view logs
CREATE POLICY "Admins can view cron logs" ON cron_logs
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );
