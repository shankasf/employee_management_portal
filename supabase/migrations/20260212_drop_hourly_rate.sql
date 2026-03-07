-- Remove hourly_rate column from employees table (pay tracking removed)
ALTER TABLE employees DROP COLUMN IF EXISTS hourly_rate;
