-- Normalize messy schedules.location free-text to the 6 canonical mall labels.
-- (2026-06-08) Only unambiguous values are mapped; ambiguous ones are left as-is:
--   bare 'Toy Republic' (no mall), combined-brand 'TR/PF' etc., 'TR PK', placeholders.
-- Matching collapses internal whitespace + lowercases so spacing/case variants all hit.

\set ON_ERROR_STOP on

-- 1) Backup every (id, location) before touching anything.
\copy (SELECT json_agg(json_build_object('id', id, 'location', location)) FROM schedules WHERE location IS NOT NULL) TO 'backups/schedule_locations_backup_2026-06-08.json'

BEGIN;

-- PlayFunia - Crossgates Mall (PlayFunia only operates at Crossgates)
WITH norm AS (SELECT id, lower(btrim(regexp_replace(location, '\s+', ' ', 'g'))) AS k FROM schedules WHERE location IS NOT NULL)
UPDATE schedules s SET location = 'PlayFunia - Crossgates Mall'
FROM norm WHERE norm.id = s.id AND norm.k IN (
  'playfunia', 'playfunia.', 'play funia', 'playafunja', 'pf cg'
);

-- Toy Republic - Crossgates Mall (Albany == Crossgates)
WITH norm AS (SELECT id, lower(btrim(regexp_replace(location, '\s+', ' ', 'g'))) AS k FROM schedules WHERE location IS NOT NULL)
UPDATE schedules s SET location = 'Toy Republic - Crossgates Mall'
FROM norm WHERE norm.id = s.id AND norm.k IN (
  'toy republic | albany', 'toy republic albany',
  'toy republic crossgates mall', 'toy republic | crossgates mall',
  'toy republic| crossgates mall', 'toy republic crossgate', 'toy republic | crossgate'
);

-- Toy Republic - Palisades Center Mall
WITH norm AS (SELECT id, lower(btrim(regexp_replace(location, '\s+', ' ', 'g'))) AS k FROM schedules WHERE location IS NOT NULL)
UPDATE schedules s SET location = 'Toy Republic - Palisades Center Mall'
FROM norm WHERE norm.id = s.id AND norm.k IN (
  'palisades', 'palisades center', 'toy republic | palisades', 'toy republic - palisades',
  'toy republic | palisades center mall', 'toy republic palisades'
);

-- Toy Republic - Poughkeepsie Galleria Mall
WITH norm AS (SELECT id, lower(btrim(regexp_replace(location, '\s+', ' ', 'g'))) AS k FROM schedules WHERE location IS NOT NULL)
UPDATE schedules s SET location = 'Toy Republic - Poughkeepsie Galleria Mall'
FROM norm WHERE norm.id = s.id AND norm.k IN (
  'poughkeepsie', 'poughkeepsie, ny', 'toy republic | poughkeepsie',
  'toy republic | poughkeepsie galleria', 'toy republic poughkeepsie', 'tr poughkeepsie'
);

-- Toy Republic - Garden State Plaza Mall
WITH norm AS (SELECT id, lower(btrim(regexp_replace(location, '\s+', ' ', 'g'))) AS k FROM schedules WHERE location IS NOT NULL)
UPDATE schedules s SET location = 'Toy Republic - Garden State Plaza Mall'
FROM norm WHERE norm.id = s.id AND norm.k IN (
  'garden state', 'garden state plaza', 'toy republic | garden state plaza', 'gsp', 'tr gsp'
);

-- Toy Republic - Paramus Park Mall
WITH norm AS (SELECT id, lower(btrim(regexp_replace(location, '\s+', ' ', 'g'))) AS k FROM schedules WHERE location IS NOT NULL)
UPDATE schedules s SET location = 'Toy Republic - Paramus Park Mall'
FROM norm WHERE norm.id = s.id AND norm.k IN (
  'paramus park', 'toy republic | paramus park', 'toy republic paramus', 'tr pp'
);

COMMIT;
