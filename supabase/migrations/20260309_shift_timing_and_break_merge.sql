-- Migration: Add shift_timing column, break_locations JSONB, merge same-day entries, populate shift_timing
-- Date: 2026-03-09

BEGIN;

-- 1. Add new columns
ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS shift_timing TEXT DEFAULT 'Not set';
ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS break_locations JSONB DEFAULT '[]'::jsonb;

-- 2. Update the compute_total_hours trigger to subtract break_minutes
CREATE OR REPLACE FUNCTION compute_total_hours()
RETURNS TRIGGER AS $$
DECLARE
    scheduled_hours NUMERIC;
BEGIN
    IF NEW.clock_out IS NOT NULL AND NEW.clock_in IS NOT NULL THEN
        NEW.total_hours := ROUND(
            (EXTRACT(EPOCH FROM (NEW.clock_out - NEW.clock_in)) / 3600.0
             - COALESCE(NEW.break_minutes, 0) / 60.0)::numeric,
            2
        );
        IF NEW.total_hours < 0 THEN
            NEW.total_hours := 0;
        END IF;

        -- Cap at scheduled hours if a schedule exists
        SELECT ROUND(
            (EXTRACT(EPOCH FROM (s.end_time::time - s.start_time::time)) / 3600.0)::numeric,
            2
        ) INTO scheduled_hours
        FROM schedules s
        WHERE s.employee_id = NEW.employee_id
          AND s.schedule_date = (NEW.clock_in AT TIME ZONE 'America/New_York')::date
          AND s.status != 'cancelled'
        ORDER BY s.start_time ASC
        LIMIT 1;

        IF scheduled_hours IS NOT NULL AND NEW.total_hours > scheduled_hours THEN
            NEW.total_hours := scheduled_hours;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Merge same-day attendance entries (group by employee_id + NY date)
-- For each group with multiple entries, keep the earliest clock_in row and merge data into it
DO $$
DECLARE
    grp RECORD;
    keeper_id UUID;
    latest_row RECORD;
    total_break_gap INTEGER;
    sum_work_hours NUMERIC;
    prev_clock_out TIMESTAMPTZ;
    entry RECORD;
    gap_minutes INTEGER;
BEGIN
    -- Find groups with multiple entries per employee per NY date
    FOR grp IN
        SELECT employee_id,
               (clock_in AT TIME ZONE 'America/New_York')::date AS ny_date,
               COUNT(*) AS cnt
        FROM attendance_logs
        GROUP BY employee_id, (clock_in AT TIME ZONE 'America/New_York')::date
        HAVING COUNT(*) > 1
    LOOP
        -- Get all entries for this group ordered by clock_in
        total_break_gap := 0;
        sum_work_hours := 0;
        prev_clock_out := NULL;
        keeper_id := NULL;

        FOR entry IN
            SELECT *
            FROM attendance_logs
            WHERE employee_id = grp.employee_id
              AND (clock_in AT TIME ZONE 'America/New_York')::date = grp.ny_date
            ORDER BY clock_in ASC
        LOOP
            IF keeper_id IS NULL THEN
                -- First entry = keeper
                keeper_id := entry.id;
                prev_clock_out := entry.clock_out;
                -- Add this entry's working hours
                IF entry.total_hours IS NOT NULL THEN
                    sum_work_hours := sum_work_hours + entry.total_hours;
                ELSIF entry.clock_out IS NOT NULL THEN
                    sum_work_hours := sum_work_hours + EXTRACT(EPOCH FROM (entry.clock_out - entry.clock_in)) / 3600.0;
                END IF;
            ELSE
                -- Subsequent entries: calculate gap from previous clock_out
                IF prev_clock_out IS NOT NULL THEN
                    gap_minutes := GREATEST(0, EXTRACT(EPOCH FROM (entry.clock_in - prev_clock_out)) / 60.0)::INTEGER;
                    total_break_gap := total_break_gap + gap_minutes;
                END IF;

                -- Add this entry's working hours
                IF entry.total_hours IS NOT NULL THEN
                    sum_work_hours := sum_work_hours + entry.total_hours;
                ELSIF entry.clock_out IS NOT NULL THEN
                    sum_work_hours := sum_work_hours + EXTRACT(EPOCH FROM (entry.clock_out - entry.clock_in)) / 3600.0;
                END IF;

                prev_clock_out := entry.clock_out;
                -- Track latest entry for clock_out data
                latest_row := entry;
            END IF;
        END LOOP;

        -- Update the keeper row with merged data
        IF keeper_id IS NOT NULL AND latest_row.id IS NOT NULL THEN
            UPDATE attendance_logs
            SET clock_out = latest_row.clock_out,
                clock_out_device_id = latest_row.clock_out_device_id,
                clock_out_device_name = latest_row.clock_out_device_name,
                clock_out_lat = latest_row.clock_out_lat,
                clock_out_lng = latest_row.clock_out_lng,
                clock_out_accuracy = latest_row.clock_out_accuracy,
                clock_out_location_status = latest_row.clock_out_location_status,
                actual_clock_out = latest_row.actual_clock_out,
                late_clock_out_minutes = latest_row.late_clock_out_minutes,
                break_minutes = COALESCE(break_minutes, 0) + total_break_gap,
                total_hours = sum_work_hours,
                updated_at = NOW()
            WHERE id = keeper_id;

            -- Delete extra rows (all except keeper)
            DELETE FROM attendance_logs
            WHERE employee_id = grp.employee_id
              AND (clock_in AT TIME ZONE 'America/New_York')::date = grp.ny_date
              AND id != keeper_id;
        END IF;
    END LOOP;
END $$;

-- 4. Populate shift_timing from schedules table for all existing attendance_logs
UPDATE attendance_logs al
SET shift_timing = sub.timing
FROM (
    SELECT al2.id,
           COALESCE(
               (SELECT to_char(s.start_time::time, 'HH:MI AM') || ' - ' || to_char(s.end_time::time, 'HH:MI AM')
                FROM schedules s
                WHERE s.employee_id = al2.employee_id
                  AND s.schedule_date = (al2.clock_in AT TIME ZONE 'America/New_York')::date
                  AND s.status != 'cancelled'
                ORDER BY s.start_time ASC
                LIMIT 1),
               'Not set'
           ) AS timing
    FROM attendance_logs al2
) sub
WHERE al.id = sub.id;

COMMIT;
