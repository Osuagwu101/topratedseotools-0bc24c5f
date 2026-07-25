-- === tool_overrides: admin-editable metadata for existing hardcoded tools ===
CREATE TABLE public.tool_overrides (
  tool_slug TEXT PRIMARY KEY,
  name TEXT,
  tagline TEXT,
  description TEXT,
  category TEXT,
  domain TEXT,
  image_url TEXT,
  is_visible BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.tool_overrides TO anon, authenticated;
GRANT ALL ON public.tool_overrides TO service_role;

ALTER TABLE public.tool_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read tool overrides"
  ON public.tool_overrides FOR SELECT
  USING (true);

CREATE POLICY "Admins can insert tool overrides"
  ON public.tool_overrides FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update tool overrides"
  ON public.tool_overrides FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete tool overrides"
  ON public.tool_overrides FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER tg_tool_overrides_touch_updated_at
  BEFORE UPDATE ON public.tool_overrides
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();


-- === promotions: simple offers manageable from the admin dashboard ===
CREATE TABLE public.promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  tool_slug TEXT,
  audience TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('new','existing','all')),
  discount_type TEXT CHECK (discount_type IN ('percent','amount','free_days','bundle')),
  discount_value NUMERIC,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.promotions TO anon, authenticated;
GRANT ALL ON public.promotions TO service_role;

ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read active promotions"
  ON public.promotions FOR SELECT
  USING (
    is_active
    AND (starts_at IS NULL OR starts_at <= now())
    AND (ends_at IS NULL OR ends_at >= now())
  );

CREATE POLICY "Admins can read all promotions"
  ON public.promotions FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert promotions"
  ON public.promotions FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update promotions"
  ON public.promotions FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete promotions"
  ON public.promotions FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX promotions_active_idx ON public.promotions (is_active, ends_at);
CREATE INDEX promotions_tool_slug_idx ON public.promotions (tool_slug);

CREATE TRIGGER tg_promotions_touch_updated_at
  BEFORE UPDATE ON public.promotions
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();