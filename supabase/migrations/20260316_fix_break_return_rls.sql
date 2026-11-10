-- Fix: Allow employees to update their own attendance records for break returns
-- The old policy only allowed updates when clock_out IS NULL, which blocked
-- the break return flow (reopening a completed entry by setting clock_out back to null).
-- This caused silent update failures (0 rows affected, no error) when clocking
-- back in from lunch.

BEGIN;

DROP POLICY IF EXISTS "Employees can clock out" ON attendance_logs;
CREATE POLICY "Employees can update own attendance" ON attendance_logs
  FOR UPDATE
  USING (auth.uid() = employee_id)
  WITH CHECK (auth.uid() = employee_id);

COMMIT;
