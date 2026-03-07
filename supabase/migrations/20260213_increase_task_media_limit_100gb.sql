-- Remove task-media bucket file size limit (was 10GB, now unlimited at bucket level)
-- Client-side validation enforces 100GB per file
UPDATE storage.buckets
SET file_size_limit = NULL
WHERE id = 'task-media';
