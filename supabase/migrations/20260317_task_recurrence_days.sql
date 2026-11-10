-- Add recurrence_days column to tasks table
-- Values: ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']
-- Empty array or NULL = no day filter (backward compatible, all days eligible)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_days TEXT[] DEFAULT '{}';
