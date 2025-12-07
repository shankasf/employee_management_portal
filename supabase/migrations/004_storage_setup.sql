-- Supabase SQL Migration: 004_storage_setup.sql
-- Storage bucket setup for task media

-- Create the task-media bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'task-media',
  'task-media',
  FALSE,
  52428800, -- 50MB limit
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm']
);

-- Storage policies for task-media bucket

-- Allow authenticated users to upload to their own folder
CREATE POLICY "Users can upload own task media"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'task-media'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow users to view their own uploads
CREATE POLICY "Users can view own task media"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'task-media'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow admins to view all uploads
CREATE POLICY "Admins can view all task media" ON storage.objects FOR
SELECT USING (
        bucket_id = 'task-media'
        AND EXISTS (
            SELECT 1
            FROM profiles
            WHERE
                id = auth.uid ()
                AND role = 'admin'
        )
    );

-- Allow users to delete their own uploads
CREATE POLICY "Users can delete own task media"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'task-media'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow admins to delete any uploads
CREATE POLICY "Admins can delete task media" ON storage.objects FOR DELETE USING (
    bucket_id = 'task-media'
    AND EXISTS (
        SELECT 1
        FROM profiles
        WHERE
            id = auth.uid ()
            AND role = 'admin'
    )
);

-- =====================================================
-- Function: Clean up old task media (to be run by cron)
-- Purpose: Delete media files older than 30 days
-- =====================================================
CREATE OR REPLACE FUNCTION cleanup_old_task_media()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER := 0;
  old_task RECORD;
BEGIN
  -- Find task instances with media older than 30 days
  FOR old_task IN 
    SELECT id, photo_url, video_url
    FROM task_instances
    WHERE (photo_url IS NOT NULL OR video_url IS NOT NULL)
    AND completed_at < NOW() - INTERVAL '30 days'
  LOOP
    -- Clear the URLs (actual storage deletion would need to be done via Edge Function)
    UPDATE task_instances
    SET 
      photo_url = NULL,
      video_url = NULL
    WHERE id = old_task.id;
    
    deleted_count := deleted_count + 1;
  END LOOP;

  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;