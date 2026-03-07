-- Add late clock-out tracking columns to attendance_logs
-- actual_clock_out: stores the real clock-out time when employee clocked out after scheduled end
-- late_clock_out_minutes: how many minutes past the scheduled end time

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_logs' AND column_name = 'actual_clock_out') THEN
        ALTER TABLE attendance_logs ADD COLUMN actual_clock_out TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_logs' AND column_name = 'late_clock_out_minutes') THEN
        ALTER TABLE attendance_logs ADD COLUMN late_clock_out_minutes INTEGER;
    END IF;
END $$;
