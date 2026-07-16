
CREATE TABLE public.tool_pricing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_slug text NOT NULL,
  label text,
  amount numeric(12,2),
  unit text,
  currency text NOT NULL DEFAULT '₦',
  contact_admin boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tool_pricing_tool_slug_idx ON public.tool_pricing(tool_slug);

GRANT SELECT ON public.tool_pricing TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.tool_pricing TO authenticated;
GRANT ALL ON public.tool_pricing TO service_role;

ALTER TABLE public.tool_pricing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone can read tool pricing" ON public.tool_pricing
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "admins can insert tool pricing" ON public.tool_pricing
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "admins can update tool pricing" ON public.tool_pricing
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "admins can delete tool pricing" ON public.tool_pricing
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER tool_pricing_touch_updated_at
  BEFORE UPDATE ON public.tool_pricing
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- Seed initial pricing
INSERT INTO public.tool_pricing (tool_slug, label, amount, unit, sort_order) VALUES
  ('stealthwriter', NULL, 17000, 'month', 0),
  ('chatgpt',       NULL,  8500, 'month', 0),
  ('capcut',        NULL,  5000, 'month', 0),
  ('canva-pro',     'Shared account',  3000, 'year', 0),
  ('canva-pro',     'Private account', 6500, 'year', 1),
  ('phrasly',       NULL,  8500, 'month', 0),
  ('quillbot',      NULL,  2500, 'month', 0),
  ('grammarly',     NULL,  2500, 'month', 0),
  ('semrush',       NULL,  3000, 'month', 0),
  ('turnitin',      NULL,  2300, 'check', 0);

-- Every other tool defaults to "Contact admin"
INSERT INTO public.tool_pricing (tool_slug, contact_admin)
SELECT slug, true FROM (VALUES
  ('ahrefs'),('midjourney'),('elevenlabs'),('originality-ai'),('gptzero'),
  ('deepl'),('notion-ai'),('gamma'),('suno'),('perplexity'),('prompt-lab')
) AS t(slug);
