-- Fix profile-pictures storage RLS policies
--
-- Problems fixed:
-- 1. INSERT policy used (storage.foldername(name))[1] IS NOT NULL which blocks root-level uploads
--    (files are stored as profile_{userId}_{timestamp}.ext at bucket root, not in folders)
-- 2. UPDATE/DELETE policies had no ownership checks (any auth user could modify any file)
--
-- New policies enforce ownership: file name must start with profile_{auth.uid()}_
-- Admins can upload/update/delete any profile picture (needed for managing employees)

-- Drop the broken policies
DROP POLICY IF EXISTS "Users can upload their own profile picture" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own profile picture" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own profile picture" ON storage.objects;

-- INSERT: Own files OR admin
CREATE POLICY "Users can upload their own profile picture"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'profile-pictures'
  AND (
    name LIKE 'profile_' || auth.uid()::text || '_%'
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  )
);

-- UPDATE: Own files OR admin
CREATE POLICY "Users can update their own profile picture"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'profile-pictures'
  AND (
    name LIKE 'profile_' || auth.uid()::text || '_%'
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  )
)
WITH CHECK (
  bucket_id = 'profile-pictures'
  AND (
    name LIKE 'profile_' || auth.uid()::text || '_%'
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  )
);

-- DELETE: Own files OR admin
CREATE POLICY "Users can delete their own profile picture"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'profile-pictures'
  AND (
    name LIKE 'profile_' || auth.uid()::text || '_%'
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  )
);

-- Public read policy remains unchanged (already correct)
