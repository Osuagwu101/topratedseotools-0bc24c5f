
ALTER TABLE public.tool_settings
  ADD COLUMN IF NOT EXISTS one_click_auth_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS official_login_url TEXT,
  ADD COLUMN IF NOT EXISTS auth_provider TEXT,
  ADD COLUMN IF NOT EXISTS launch_mode TEXT NOT NULL DEFAULT 'new_tab',
  ADD COLUMN IF NOT EXISTS display_manual_credentials BOOLEAN NOT NULL DEFAULT true;
