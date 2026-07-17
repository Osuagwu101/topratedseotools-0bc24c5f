
-- Extend blog_posts
ALTER TABLE public.blog_posts
  ADD COLUMN IF NOT EXISTS canonical_url text,
  ADD COLUMN IF NOT EXISTS og_title text,
  ADD COLUMN IF NOT EXISTS og_description text,
  ADD COLUMN IF NOT EXISTS og_image text,
  ADD COLUMN IF NOT EXISTS twitter_title text,
  ADD COLUMN IF NOT EXISTS twitter_description text,
  ADD COLUMN IF NOT EXISTS twitter_image text,
  ADD COLUMN IF NOT EXISTS semantic_keywords text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS faq jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS image_alts jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS cta_template_id uuid;

-- Extend blog_settings for editor prefs
ALTER TABLE public.blog_settings
  ADD COLUMN IF NOT EXISTS keyword_highlight_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS keyword_highlight_color text NOT NULL DEFAULT '#fde68a';

-- CTA templates
CREATE TABLE IF NOT EXISTS public.blog_cta_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  button_label text NOT NULL,
  button_url text NOT NULL,
  target_tool_slugs text[] NOT NULL DEFAULT '{}',
  target_category_slugs text[] NOT NULL DEFAULT '{}',
  priority integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.blog_cta_templates TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.blog_cta_templates TO authenticated;
GRANT ALL ON public.blog_cta_templates TO service_role;

ALTER TABLE public.blog_cta_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cta_public_read"
  ON public.blog_cta_templates FOR SELECT
  USING (true);

CREATE POLICY "cta_admin_insert"
  ON public.blog_cta_templates FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "cta_admin_update"
  ON public.blog_cta_templates FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "cta_admin_delete"
  ON public.blog_cta_templates FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER blog_cta_templates_touch
  BEFORE UPDATE ON public.blog_cta_templates
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- Seed a sensible default CTA (only if none exist)
INSERT INTO public.blog_cta_templates (name, title, body, button_label, button_url, priority, is_default)
SELECT
  'Default subscription CTA',
  'Get instant access to premium SEO tools',
  'Skip the individual subscriptions. Access Stealthwriter, Phrasly, Quillbot, Grammarly, Semrush and more at a fraction of the cost.',
  'View pricing',
  '/pricing',
  0,
  true
WHERE NOT EXISTS (SELECT 1 FROM public.blog_cta_templates);
