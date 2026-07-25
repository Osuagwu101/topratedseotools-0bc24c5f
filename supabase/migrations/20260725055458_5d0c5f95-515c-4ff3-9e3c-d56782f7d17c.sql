ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS maintenance_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS orders_paused boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payments_paused boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS emails_paused boolean NOT NULL DEFAULT false;