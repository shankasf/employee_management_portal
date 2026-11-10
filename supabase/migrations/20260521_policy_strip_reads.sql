-- ============================================================================
-- Important Messages: per-employee read receipts for policy_strips
-- ============================================================================
-- Tracks which employees have marked which active message as read so admins
-- can see who has and who has not acknowledged each message.
-- ============================================================================

CREATE TABLE IF NOT EXISTS policy_strip_reads (
  policy_strip_id UUID NOT NULL REFERENCES policy_strips(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (policy_strip_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_policy_strip_reads_employee ON policy_strip_reads(employee_id);
CREATE INDEX IF NOT EXISTS idx_policy_strip_reads_strip ON policy_strip_reads(policy_strip_id);

ALTER TABLE policy_strip_reads ENABLE ROW LEVEL SECURITY;

-- Employees can record their own reads.
DROP POLICY IF EXISTS "Employees insert own reads" ON policy_strip_reads;
CREATE POLICY "Employees insert own reads"
  ON policy_strip_reads
  FOR INSERT
  WITH CHECK (auth.uid() = employee_id);

-- Employees can read their own read receipts.
DROP POLICY IF EXISTS "Employees view own reads" ON policy_strip_reads;
CREATE POLICY "Employees view own reads"
  ON policy_strip_reads
  FOR SELECT
  USING (auth.uid() = employee_id);

-- Admins can see all read receipts.
DROP POLICY IF EXISTS "Admins view all reads" ON policy_strip_reads;
CREATE POLICY "Admins view all reads"
  ON policy_strip_reads
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'
  ));
