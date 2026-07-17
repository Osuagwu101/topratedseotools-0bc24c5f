
CREATE TABLE public.ai_generator_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'google',
  model text NOT NULL DEFAULT 'google/gemini-3-flash-preview',
  default_language text NOT NULL DEFAULT 'English',
  default_country text,
  default_tone text NOT NULL DEFAULT 'Informative',
  default_audience text NOT NULL DEFAULT 'General readers',
  default_reading_level text NOT NULL DEFAULT 'Intermediate',
  default_writing_style text NOT NULL DEFAULT 'Blog',
  default_length text NOT NULL DEFAULT 'Long (2000-2500 words)',
  brand_voice text,
  singleton boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_generator_settings_singleton_uniq UNIQUE (singleton)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_generator_settings TO authenticated;
GRANT ALL ON public.ai_generator_settings TO service_role;

ALTER TABLE public.ai_generator_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read AI generator settings"
  ON public.ai_generator_settings FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert AI generator settings"
  ON public.ai_generator_settings FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update AI generator settings"
  ON public.ai_generator_settings FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_ai_generator_settings_updated_at
  BEFORE UPDATE ON public.ai_generator_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- Seed the singleton row
INSERT INTO public.ai_generator_settings (provider, model) VALUES ('google', 'google/gemini-3-flash-preview')
ON CONFLICT DO NOTHING;
