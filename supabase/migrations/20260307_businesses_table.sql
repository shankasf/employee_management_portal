-- Create businesses table
CREATE TABLE IF NOT EXISTS businesses (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(name, location)
);

-- Create junction table
CREATE TABLE IF NOT EXISTS employee_businesses (
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  PRIMARY KEY (employee_id, business_id)
);

-- Seed businesses
INSERT INTO businesses (name, location) VALUES
  ('PlayFunia', 'Albany, NY'),
  ('Toy Republic', 'Albany, NY'),
  ('Toy Republic', 'Paramus Park Mall, NJ'),
  ('Toy Republic', 'Paramus Garden State Plaza, NJ'),
  ('Toy Republic', 'Poughkeepsie, NY'),
  ('Toy Republic', 'West Nyack, NY'),
  ('Real International LLC', NULL)
ON CONFLICT (name, location) DO NOTHING;

-- Migrate: Albany employees (both PlayFunia & Toy Republic)
INSERT INTO employee_businesses (employee_id, business_id)
SELECT e.id, b.id FROM employees e, businesses b
WHERE e.company_name IN ('Toy Republic & PlayFunia', 'PlayFunia & Toy Republic')
  AND b.name = 'PlayFunia' AND b.location = 'Albany, NY'
ON CONFLICT DO NOTHING;

INSERT INTO employee_businesses (employee_id, business_id)
SELECT e.id, b.id FROM employees e, businesses b
WHERE e.company_name IN ('Toy Republic & PlayFunia', 'PlayFunia & Toy Republic')
  AND b.name = 'Toy Republic' AND b.location = 'Albany, NY'
ON CONFLICT DO NOTHING;

-- Migrate: Poughkeepsie employees
INSERT INTO employee_businesses (employee_id, business_id)
SELECT e.id, b.id FROM employees e, businesses b
WHERE e.company_name = 'Toy Republic' AND e.work_location = 'Poughkeepsie, NY'
  AND b.name = 'Toy Republic' AND b.location = 'Poughkeepsie, NY'
ON CONFLICT DO NOTHING;

-- Migrate: West Nyack employees
INSERT INTO employee_businesses (employee_id, business_id)
SELECT e.id, b.id FROM employees e, businesses b
WHERE e.company_name = 'Toy Republic' AND e.work_location = 'West Nyack, NY'
  AND b.name = 'Toy Republic' AND b.location = 'West Nyack, NY'
ON CONFLICT DO NOTHING;

-- Migrate: Real International employees
INSERT INTO employee_businesses (employee_id, business_id)
SELECT e.id, b.id FROM employees e, businesses b
WHERE e.company_name IN ('Real International', 'Real International LLC')
  AND b.name = 'Real International LLC'
ON CONFLICT DO NOTHING;

-- Enable RLS
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_businesses ENABLE ROW LEVEL SECURITY;

-- RLS policies: all authenticated users can read businesses
CREATE POLICY "Authenticated users can read businesses"
  ON businesses FOR SELECT TO authenticated USING (true);

-- RLS: employees can read their own assignments, admins can read all
CREATE POLICY "Users can read own business assignments"
  ON employee_businesses FOR SELECT TO authenticated
  USING (employee_id = auth.uid() OR EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  ));

-- RLS: only admins can insert/update/delete employee_businesses
CREATE POLICY "Admins can manage business assignments"
  ON employee_businesses FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- RLS: only admins can manage businesses table
CREATE POLICY "Admins can manage businesses"
  ON businesses FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- Update RPC to use junction table
CREATE OR REPLACE FUNCTION get_employee_shift_info()
RETURNS TABLE (shift_type TEXT, shift_start TIME, shift_end TIME, company_name TEXT, work_location TEXT) AS $$
BEGIN
  RETURN QUERY
    SELECT e.shift_type, e.shift_start, e.shift_end,
      (SELECT string_agg(b.name || COALESCE(' - ' || b.location, ''), ', ')
       FROM employee_businesses eb JOIN businesses b ON b.id = eb.business_id
       WHERE eb.employee_id = auth.uid()) as company_name,
      e.work_location
    FROM employees e WHERE e.id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
