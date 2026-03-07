-- Add reminder_sent_at column to task_instances for deadline reminder tracking
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'task_instances'
      AND column_name = 'reminder_sent_at'
  ) THEN
    ALTER TABLE public.task_instances ADD COLUMN reminder_sent_at TIMESTAMPTZ DEFAULT NULL;
  END IF;
END $$;
