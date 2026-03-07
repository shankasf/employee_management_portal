-- Create a public bucket for profile pictures (non-sensitive images)
-- This eliminates the need for signed URLs that expire after 1 hour
INSERT INTO storage.buckets (id, name, public)
VALUES ('profile-pictures', 'profile-pictures', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload to their own path (profile_<user_id>_*)
-- Admins can upload on behalf of any employee
CREATE POLICY "Users can upload their own profile picture"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'profile-pictures'
  AND (
    name LIKE 'profile_' || auth.uid()::text || '_%'
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  )
);

-- Allow anyone to read profile pictures (public bucket)
CREATE POLICY "Public read access for profile pictures"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'profile-pictures');

-- Allow authenticated users to update/overwrite their own profile pictures
-- Admins can update any profile picture
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

-- Allow authenticated users to delete their own profile pictures
-- Admins can delete any profile picture
CREATE POLICY "Users can delete their own profile picture"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'profile-pictures'
  AND (
    name LIKE 'profile_' || auth.uid()::text || '_%'
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  )
);
