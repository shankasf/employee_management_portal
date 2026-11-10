-- Scoped Admin — Migration 1: schema
-- Adds super-admin + scoped-admin flags to profiles and an admin_businesses
-- assignment table. Idempotent so it can be re-run safely.

BEGIN;

-- 1. Flags on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_super_admin boolean NOT NULL DEFAULT false;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS admin_scoped boolean NOT NULL DEFAULT false;

-- 2. Admin → managed locations (which businesses a scoped admin oversees)
CREATE TABLE IF NOT EXISTS public.admin_businesses (
  id          serial PRIMARY KEY,
  admin_id    uuid    NOT NULL REFERENCES public.profiles(id)   ON DELETE CASCADE,
  business_id integer NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (admin_id, business_id)
);

CREATE INDEX IF NOT EXISTS idx_admin_businesses_admin ON public.admin_businesses(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_businesses_business ON public.admin_businesses(business_id);

ALTER TABLE public.admin_businesses ENABLE ROW LEVEL SECURITY;

-- 3. Seed the two super admins (Ali & Emel)
UPDATE public.profiles
SET is_super_admin = true
WHERE id IN (
  'ba7dae43-7464-4cd1-89df-34d90cc776f7', -- ALI GUMUSTOP
  'db7c730f-651b-48c0-9157-cef29c134135'  -- Emel Gumustop
);

COMMIT;
