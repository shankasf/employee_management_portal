-- Rename businesses to canonical mall locations (per scheduling ACs, 2026-06-08)
-- Renames in place by (name, location) so business ids and all employee_businesses
-- assignments are preserved. Non-destructive: no rows added or deleted.
-- 'Real International LLC' is intentionally left untouched (not a scheduling location).

UPDATE businesses SET location = 'Crossgates Mall'
  WHERE name = 'PlayFunia' AND location = 'Albany, NY';

UPDATE businesses SET location = 'Crossgates Mall'
  WHERE name = 'Toy Republic' AND location = 'Albany, NY';

UPDATE businesses SET location = 'Paramus Park Mall'
  WHERE name = 'Toy Republic' AND location = 'Paramus Park Mall, NJ';

UPDATE businesses SET location = 'Garden State Plaza Mall'
  WHERE name = 'Toy Republic' AND location = 'Paramus Garden State Plaza, NJ';

UPDATE businesses SET location = 'Poughkeepsie Galleria Mall'
  WHERE name = 'Toy Republic' AND location = 'Poughkeepsie, NY';

UPDATE businesses SET location = 'Palisades Center Mall'
  WHERE name = 'Toy Republic' AND location = 'West Nyack, NY';
