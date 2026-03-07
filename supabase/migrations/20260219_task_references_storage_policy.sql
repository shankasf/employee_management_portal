-- Allow all authenticated users to view task reference images/videos
-- Reference media is uploaded by admins to task-references/{taskId}/ path
-- Employees need to view these when completing assigned tasks
DROP POLICY IF EXISTS "Users can view task references" ON storage.objects;
CREATE POLICY "Users can view task references" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'task-media'
    AND (storage.foldername(name))[1] = 'task-references'
    AND auth.uid() IS NOT NULL
  );
