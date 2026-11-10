-- Auto clock-out for forgotten/open shifts.
--
-- Closes any attendance_logs row that still has clock_out IS NULL, setting
-- clock_out to the END OF THE NY DAY (23:59:59 America/New_York) of the shift's
-- own clock_in date -- but only once that end-of-day moment has already passed.
-- This means a shift is closed shortly after midnight ET on the night it ended,
-- and pre-existing stragglers are each closed at their own day's end of day.
--
-- total_hours is computed (and capped at scheduled hours when a schedule exists)
-- by the existing BEFORE UPDATE trigger compute_total_hours().

-- 1. Flag so admins can tell system-closed shifts from real clock-outs.
ALTER TABLE public.attendance_logs
    ADD COLUMN IF NOT EXISTS auto_clocked_out boolean NOT NULL DEFAULT false;

-- 2. Function: close all overdue open shifts at their NY end-of-day.
CREATE OR REPLACE FUNCTION public.auto_clock_out_open_shifts()
RETURNS TABLE (id uuid, employee_id uuid, clock_in timestamptz, clock_out timestamptz, total_hours numeric)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    UPDATE public.attendance_logs a
    SET clock_out = sub.ny_eod,
        auto_clocked_out = true
    FROM (
        SELECT al.id,
            -- next NY midnight (as timestamptz) minus 1s = that day's 23:59:59 ET
            ((((al.clock_in AT TIME ZONE 'America/New_York')::date + 1)::timestamp
                AT TIME ZONE 'America/New_York') - interval '1 second') AS ny_eod
        FROM public.attendance_logs al
        WHERE al.clock_out IS NULL
    ) sub
    WHERE a.id = sub.id
      AND sub.ny_eod < now()
    RETURNING a.id, a.employee_id, a.clock_in, a.clock_out, a.total_hours;
END;
$$;
