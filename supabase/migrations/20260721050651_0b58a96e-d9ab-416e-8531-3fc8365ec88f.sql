
ALTER TABLE public.tool_settings
  ADD COLUMN IF NOT EXISTS shared_access_authorization text NOT NULL DEFAULT 'confirmed'
    CHECK (shared_access_authorization IN ('confirmed','not_confirmed','not_applicable')),
  ADD COLUMN IF NOT EXISTS private_access_authorization text NOT NULL DEFAULT 'confirmed'
    CHECK (private_access_authorization IN ('confirmed','not_confirmed','not_applicable'));
