
CREATE TABLE IF NOT EXISTS public.tool_credentials (
  tool_slug text PRIMARY KEY,
  login_email text,
  login_password text,
  login_url text,
  login_notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tool_credentials TO authenticated;
GRANT ALL ON public.tool_credentials TO service_role;

ALTER TABLE public.tool_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tool_credentials admins full access" ON public.tool_credentials;
CREATE POLICY "tool_credentials admins full access"
  ON public.tool_credentials FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Backfill from any values that may have been stored on tool_settings
INSERT INTO public.tool_credentials (tool_slug, login_email, login_password, login_url, login_notes)
SELECT tool_slug, login_email, login_password, login_url, login_notes
FROM public.tool_settings
WHERE login_email IS NOT NULL OR login_password IS NOT NULL OR login_url IS NOT NULL OR login_notes IS NOT NULL
ON CONFLICT (tool_slug) DO NOTHING;

ALTER TABLE public.tool_settings
  DROP COLUMN IF EXISTS login_email,
  DROP COLUMN IF EXISTS login_password,
  DROP COLUMN IF EXISTS login_url,
  DROP COLUMN IF EXISTS login_notes;

CREATE TRIGGER tool_credentials_touch BEFORE UPDATE ON public.tool_credentials
FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
