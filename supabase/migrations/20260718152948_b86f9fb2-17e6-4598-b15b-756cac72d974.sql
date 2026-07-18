ALTER TABLE public.tool_settings
  ADD COLUMN IF NOT EXISTS shared_access_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS private_access_enabled boolean NOT NULL DEFAULT true;