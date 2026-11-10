-- ============================================================================
-- When admin moves a REQUIRED content item to a different business, the
-- destination business gains a new required item that existing "100% complete"
-- employees haven't seen. Wipe the destination's completion records so they
-- drop back to "In Progress", same way a fresh INSERT does.
-- ============================================================================

CREATE OR REPLACE FUNCTION onboarding_invalidate_completions_on_business_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.business_id <> OLD.business_id AND NEW.is_required THEN
    DELETE FROM onboarding_completions WHERE business_id = NEW.business_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_onboarding_invalidate_on_business_change ON onboarding_content;
CREATE TRIGGER trg_onboarding_invalidate_on_business_change
  AFTER UPDATE OF business_id ON onboarding_content
  FOR EACH ROW EXECUTE FUNCTION onboarding_invalidate_completions_on_business_change();
