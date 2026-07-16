-- Roles
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own roles select" ON public.user_roles
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- has_role helper (SECURITY DEFINER to avoid recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;

-- Site settings (singleton row)
CREATE TABLE public.site_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  active_theme text NOT NULL DEFAULT 'theme-1' CHECK (active_theme IN ('theme-1', 'theme-2')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

GRANT SELECT ON public.site_settings TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.site_settings TO authenticated;
GRANT ALL ON public.site_settings TO service_role;

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone can read site settings" ON public.site_settings
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "admins can insert site settings" ON public.site_settings
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins can update site settings" ON public.site_settings
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER site_settings_touch
BEFORE UPDATE ON public.site_settings
FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- Seed the single settings row
INSERT INTO public.site_settings (id, active_theme) VALUES (true, 'theme-1')
ON CONFLICT (id) DO NOTHING;
