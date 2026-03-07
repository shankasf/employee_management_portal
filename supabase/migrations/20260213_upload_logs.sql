-- Upload Logs table for tracking all file uploads across the app
-- Mirrors usage_logs pattern with upload-specific columns

CREATE TABLE IF NOT EXISTS upload_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    user_email TEXT,
    user_role TEXT,
    status TEXT NOT NULL CHECK (status IN ('attempt', 'success', 'failure', 'validation_rejected')),
    bucket TEXT,
    file_name TEXT,
    file_size BIGINT,
    mime_type TEXT,
    file_path TEXT,
    upload_context TEXT CHECK (upload_context IN (
        'employee_task_photo', 'employee_task_video',
        'admin_ref_image', 'admin_ref_video',
        'admin_id_doc', 'admin_profile_pic',
        'admin_policy_media'
    )),
    entity_id TEXT,
    error_message TEXT,
    error_code TEXT,
    user_agent TEXT,
    device_name TEXT,
    ip_address TEXT,
    duration_ms INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_upload_logs_created_at ON upload_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_upload_logs_user_id ON upload_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_upload_logs_status ON upload_logs(status);
CREATE INDEX IF NOT EXISTS idx_upload_logs_upload_context ON upload_logs(upload_context);

-- RLS policies
ALTER TABLE upload_logs ENABLE ROW LEVEL SECURITY;

-- Admins can read all upload logs
CREATE POLICY "Admins can read upload logs" ON upload_logs
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

-- Service role can insert (API route uses service role key)
-- No user-level insert policy needed since we use service role client

-- Auto-cleanup: keep logs for 90 days
-- (Optional: run via pg_cron or scheduled function)
-- DELETE FROM upload_logs WHERE created_at < NOW() - INTERVAL '90 days';
