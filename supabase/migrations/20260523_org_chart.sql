-- Org chart hierarchy: arbitrary-depth tree of nodes
-- Nodes can be people, roles, brands, or locations. Locations may reference
-- a row in `businesses` so the existing employee_businesses junction can be
-- used to render employees underneath them.

CREATE TABLE IF NOT EXISTS org_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID REFERENCES org_nodes(id) ON DELETE CASCADE,
  node_type TEXT NOT NULL CHECK (node_type IN ('person','role','brand','location')),
  name TEXT NOT NULL,
  subtitle TEXT,
  business_id INTEGER REFERENCES businesses(id) ON DELETE SET NULL,
  photo_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_org_nodes_parent ON org_nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_org_nodes_business ON org_nodes(business_id);

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION set_org_nodes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_org_nodes_updated_at ON org_nodes;
CREATE TRIGGER trg_org_nodes_updated_at
  BEFORE UPDATE ON org_nodes
  FOR EACH ROW EXECUTE FUNCTION set_org_nodes_updated_at();

-- RLS
ALTER TABLE org_nodes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read org_nodes" ON org_nodes;
CREATE POLICY "Authenticated users can read org_nodes"
  ON org_nodes FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admins can manage org_nodes" ON org_nodes;
CREATE POLICY "Admins can manage org_nodes"
  ON org_nodes FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- Seed example hierarchy (idempotent: only seeds if table is empty)
DO $$
DECLARE
  v_root UUID;
  v_lead UUID;
  v_playfunia UUID;
  v_toyrepublic UUID;
  biz RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM org_nodes LIMIT 1) THEN
    -- Top: Emel & Ali (person)
    INSERT INTO org_nodes (parent_id, node_type, name, subtitle, sort_order)
      VALUES (NULL, 'person', 'Emel & Ali', 'Owners', 0)
      RETURNING id INTO v_root;

    -- Operations Lead (role)
    INSERT INTO org_nodes (parent_id, node_type, name, subtitle, sort_order)
      VALUES (v_root, 'role', 'Operations Lead', NULL, 0)
      RETURNING id INTO v_lead;

    -- Brands
    INSERT INTO org_nodes (parent_id, node_type, name, subtitle, sort_order)
      VALUES (v_lead, 'brand', 'PlayFunia', NULL, 0)
      RETURNING id INTO v_playfunia;
    INSERT INTO org_nodes (parent_id, node_type, name, subtitle, sort_order)
      VALUES (v_lead, 'brand', 'Toy Republic', NULL, 1)
      RETURNING id INTO v_toyrepublic;

    -- Locations: PlayFunia
    FOR biz IN
      SELECT id, location FROM businesses WHERE name = 'PlayFunia' ORDER BY location
    LOOP
      INSERT INTO org_nodes (parent_id, node_type, name, subtitle, business_id, sort_order)
        VALUES (v_playfunia, 'location', COALESCE(biz.location, 'PlayFunia'), NULL, biz.id, 0);
    END LOOP;

    -- Locations: Toy Republic
    FOR biz IN
      SELECT id, location FROM businesses WHERE name = 'Toy Republic' ORDER BY location
    LOOP
      INSERT INTO org_nodes (parent_id, node_type, name, subtitle, business_id, sort_order)
        VALUES (v_toyrepublic, 'location', COALESCE(biz.location, 'Toy Republic'), NULL, biz.id, 0);
    END LOOP;
  END IF;
END $$;
