-- 1. tool_access enum
DO $$ BEGIN
  CREATE TYPE public.tool_access_level AS ENUM ('public', 'logged_in', 'purchased');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.tool_order_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled', 'expired');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 2. tool_settings
CREATE TABLE IF NOT EXISTS public.tool_settings (
  tool_slug TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT true,
  access_level public.tool_access_level NOT NULL DEFAULT 'purchased',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.tool_settings TO anon, authenticated;
GRANT ALL ON public.tool_settings TO service_role;
ALTER TABLE public.tool_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tool_settings readable by all" ON public.tool_settings;
CREATE POLICY "tool_settings readable by all" ON public.tool_settings FOR SELECT USING (true);
DROP POLICY IF EXISTS "tool_settings admin write" ON public.tool_settings;
CREATE POLICY "tool_settings admin write" ON public.tool_settings FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_tool_settings_updated
  BEFORE UPDATE ON public.tool_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- 3. tool_orders
CREATE TABLE IF NOT EXISTS public.tool_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tool_slug TEXT NOT NULL,
  pricing_option_id UUID REFERENCES public.tool_pricing(id) ON DELETE SET NULL,
  price_amount NUMERIC(12,2),
  price_label TEXT,
  currency TEXT NOT NULL DEFAULT '₦',
  status public.tool_order_status NOT NULL DEFAULT 'pending',
  notes TEXT,
  admin_notes TEXT,
  expires_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tool_orders_user ON public.tool_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_tool_orders_active ON public.tool_orders(user_id, tool_slug, status);

GRANT SELECT, INSERT, UPDATE ON public.tool_orders TO authenticated;
GRANT ALL ON public.tool_orders TO service_role;
ALTER TABLE public.tool_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orders owner select" ON public.tool_orders;
CREATE POLICY "orders owner select" ON public.tool_orders FOR SELECT
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "orders owner insert" ON public.tool_orders;
CREATE POLICY "orders owner insert" ON public.tool_orders FOR INSERT
  WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "orders owner cancel" ON public.tool_orders;
CREATE POLICY "orders owner cancel" ON public.tool_orders FOR UPDATE
  USING (auth.uid() = user_id AND status = 'pending')
  WITH CHECK (auth.uid() = user_id AND status IN ('pending','cancelled'));
DROP POLICY IF EXISTS "orders admin write" ON public.tool_orders;
CREATE POLICY "orders admin write" ON public.tool_orders FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_tool_orders_updated
  BEFORE UPDATE ON public.tool_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- 4. Helper: does current user have active access to a tool?
CREATE OR REPLACE FUNCTION public.user_has_tool_access(_user_id UUID, _slug TEXT)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tool_orders
    WHERE user_id = _user_id
      AND tool_slug = _slug
      AND status = 'approved'
      AND (expires_at IS NULL OR expires_at > now())
  );
$$;