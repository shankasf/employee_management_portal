-- ============================================================================
-- Employee Onboarding & Knowledge Dashboard
-- ============================================================================
-- Tables:
--   onboarding_content     - videos / documents / articles per business
--   onboarding_progress    - per-employee per-content tracking (max watched %)
--   onboarding_completions - per-employee per-business completion record
-- Storage bucket: onboarding-content (public read for authenticated, admin write)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- onboarding_content
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS onboarding_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('video', 'document', 'article')),
  subtype TEXT CHECK (subtype IN ('pdf', 'image', 'docx', 'audio', 'video')),
  title TEXT NOT NULL,
  description TEXT,
  content_url TEXT,        -- Storage URL for uploaded files
  content_text TEXT,       -- For rich-text articles (sanitized HTML)
  file_size BIGINT,
  duration_seconds INTEGER,-- For videos (used to enforce 90% rule)
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_content_business ON onboarding_content(business_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_content_required ON onboarding_content(business_id, is_required);
CREATE INDEX IF NOT EXISTS idx_onboarding_content_search ON onboarding_content USING gin (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,'') || ' ' || coalesce(content_text,'')));

-- ----------------------------------------------------------------------------
-- onboarding_progress
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS onboarding_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  content_id UUID NOT NULL REFERENCES onboarding_content(id) ON DELETE CASCADE,
  max_watched_pct NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (max_watched_pct >= 0 AND max_watched_pct <= 100),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, content_id)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_progress_employee ON onboarding_progress(employee_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_progress_content ON onboarding_progress(content_id);

-- ----------------------------------------------------------------------------
-- onboarding_completions
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS onboarding_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notified_at TIMESTAMPTZ,
  acknowledged_by_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, business_id)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_completions_employee ON onboarding_completions(employee_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_completions_business ON onboarding_completions(business_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_completions_unack ON onboarding_completions(acknowledged_by_admin) WHERE acknowledged_by_admin = FALSE;

-- ----------------------------------------------------------------------------
-- updated_at trigger
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION onboarding_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_onboarding_content_updated_at ON onboarding_content;
CREATE TRIGGER trg_onboarding_content_updated_at
  BEFORE UPDATE ON onboarding_content
  FOR EACH ROW EXECUTE FUNCTION onboarding_set_updated_at();

DROP TRIGGER IF EXISTS trg_onboarding_progress_updated_at ON onboarding_progress;
CREATE TRIGGER trg_onboarding_progress_updated_at
  BEFORE UPDATE ON onboarding_progress
  FOR EACH ROW EXECUTE FUNCTION onboarding_set_updated_at();

-- ----------------------------------------------------------------------------
-- When admin adds a NEW required item, drop completion records for that business
-- so existing 100% employees revert to "In Progress".
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION onboarding_invalidate_completions_on_new_required()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_required THEN
    DELETE FROM onboarding_completions WHERE business_id = NEW.business_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_onboarding_invalidate_on_insert ON onboarding_content;
CREATE TRIGGER trg_onboarding_invalidate_on_insert
  AFTER INSERT ON onboarding_content
  FOR EACH ROW EXECUTE FUNCTION onboarding_invalidate_completions_on_new_required();

-- Also invalidate when an existing item is flipped from optional -> required
CREATE OR REPLACE FUNCTION onboarding_invalidate_completions_on_required_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_required = TRUE AND OLD.is_required = FALSE THEN
    DELETE FROM onboarding_completions WHERE business_id = NEW.business_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_onboarding_invalidate_on_update ON onboarding_content;
CREATE TRIGGER trg_onboarding_invalidate_on_update
  AFTER UPDATE OF is_required ON onboarding_content
  FOR EACH ROW EXECUTE FUNCTION onboarding_invalidate_completions_on_required_change();

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
ALTER TABLE onboarding_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_completions ENABLE ROW LEVEL SECURITY;

-- onboarding_content: employees can read content for businesses they're assigned to; admins manage all
DROP POLICY IF EXISTS "onboarding_content_read" ON onboarding_content;
CREATE POLICY "onboarding_content_read"
  ON onboarding_content FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    OR EXISTS (
      SELECT 1 FROM employee_businesses
      WHERE employee_id = auth.uid() AND business_id = onboarding_content.business_id
    )
  );

DROP POLICY IF EXISTS "onboarding_content_admin_write" ON onboarding_content;
CREATE POLICY "onboarding_content_admin_write"
  ON onboarding_content FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- onboarding_progress: own rows or admin
DROP POLICY IF EXISTS "onboarding_progress_select" ON onboarding_progress;
CREATE POLICY "onboarding_progress_select"
  ON onboarding_progress FOR SELECT TO authenticated
  USING (
    employee_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "onboarding_progress_insert_own" ON onboarding_progress;
CREATE POLICY "onboarding_progress_insert_own"
  ON onboarding_progress FOR INSERT TO authenticated
  WITH CHECK (employee_id = auth.uid());

DROP POLICY IF EXISTS "onboarding_progress_update_own" ON onboarding_progress;
CREATE POLICY "onboarding_progress_update_own"
  ON onboarding_progress FOR UPDATE TO authenticated
  USING (employee_id = auth.uid())
  WITH CHECK (employee_id = auth.uid());

DROP POLICY IF EXISTS "onboarding_progress_admin_delete" ON onboarding_progress;
CREATE POLICY "onboarding_progress_admin_delete"
  ON onboarding_progress FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- onboarding_completions: own or admin (admins can also update acknowledged flag)
DROP POLICY IF EXISTS "onboarding_completions_select" ON onboarding_completions;
CREATE POLICY "onboarding_completions_select"
  ON onboarding_completions FOR SELECT TO authenticated
  USING (
    employee_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "onboarding_completions_insert_own" ON onboarding_completions;
CREATE POLICY "onboarding_completions_insert_own"
  ON onboarding_completions FOR INSERT TO authenticated
  WITH CHECK (employee_id = auth.uid());

DROP POLICY IF EXISTS "onboarding_completions_admin_update" ON onboarding_completions;
CREATE POLICY "onboarding_completions_admin_update"
  ON onboarding_completions FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- ----------------------------------------------------------------------------
-- Storage bucket: onboarding-content (public read; admin write only)
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'onboarding-content',
  'onboarding-content',
  TRUE,
  524288000, -- 500MB per file
  NULL       -- allow all (validated app-side)
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit;

-- Storage policies
DROP POLICY IF EXISTS "onboarding_storage_read_authenticated" ON storage.objects;
CREATE POLICY "onboarding_storage_read_authenticated"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'onboarding-content');

DROP POLICY IF EXISTS "onboarding_storage_admin_write" ON storage.objects;
CREATE POLICY "onboarding_storage_admin_write"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'onboarding-content'
    AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "onboarding_storage_admin_update" ON storage.objects;
CREATE POLICY "onboarding_storage_admin_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'onboarding-content'
    AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "onboarding_storage_admin_delete" ON storage.objects;
CREATE POLICY "onboarding_storage_admin_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'onboarding-content'
    AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );
