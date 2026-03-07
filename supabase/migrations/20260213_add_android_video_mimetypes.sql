-- Add Android video MIME types (video/3gpp, video/3gpp2) and Matroska (video/x-matroska)
-- to the task-media bucket. Android devices commonly record video as 3gpp/3gpp2 which
-- were previously rejected by Supabase storage, causing silent upload failures.
UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo', 'video/mpeg',
  'video/3gpp', 'video/3gpp2', 'video/x-matroska'
]
WHERE id = 'task-media';
