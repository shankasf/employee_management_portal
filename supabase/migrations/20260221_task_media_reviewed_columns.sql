-- Add media review/deletion tracking columns to task_instances
-- These columns track when an admin has reviewed and deleted task media to free storage

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'task_instances' AND column_name = 'media_deleted_at'
    ) THEN
        ALTER TABLE task_instances ADD COLUMN media_deleted_at TIMESTAMPTZ DEFAULT NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'task_instances' AND column_name = 'media_deleted_by'
    ) THEN
        ALTER TABLE task_instances ADD COLUMN media_deleted_by UUID DEFAULT NULL REFERENCES profiles(id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'task_instances' AND column_name = 'media_deleted_by_name'
    ) THEN
        ALTER TABLE task_instances ADD COLUMN media_deleted_by_name TEXT DEFAULT NULL;
    END IF;
END $$;
