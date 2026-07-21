
-- 1) marketing_integrations ---------------------------------------------------
CREATE TABLE public.marketing_integrations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider text NOT NULL UNIQUE CHECK (provider IN ('meta_pixel','meta_capi','gtm')),
  enabled boolean NOT NULL DEFAULT false,
  connected boolean NOT NULL DEFAULT false,
  -- Public IDs (safe to expose): pixel id, gtm container id
  public_id text,
  -- Test event code for Meta (safe-ish; only used against test event API)
  test_event_code text,
  -- Free-form provider config (never store secrets here)
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_event_at timestamptz,
  last_event_name text,
  last_error_at timestamptz,
  last_error_message text,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_integrations TO authenticated;
GRANT ALL ON public.marketing_integrations TO service_role;
ALTER TABLE public.marketing_integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage marketing integrations"
  ON public.marketing_integrations FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_marketing_integrations_touch
  BEFORE UPDATE ON public.marketing_integrations
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

INSERT INTO public.marketing_integrations (provider, enabled) VALUES
  ('meta_pixel', false),
  ('meta_capi', false),
  ('gtm', false)
ON CONFLICT (provider) DO NOTHING;

-- 2) marketing_events ---------------------------------------------------------
CREATE TABLE public.marketing_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_name text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('meta','gtm','internal')),
  event_id text,
  source text NOT NULL CHECK (source IN ('browser','server')),
  status text NOT NULL CHECK (status IN ('sent','failed','skipped','deduplicated','pending')),
  order_id uuid REFERENCES public.tool_orders(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  tool_slug text,
  amount numeric,
  currency text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Deduplication key: same (platform, event_id) can never be "sent" twice.
CREATE UNIQUE INDEX marketing_events_dedupe_sent
  ON public.marketing_events (platform, event_id)
  WHERE event_id IS NOT NULL AND status = 'sent';
CREATE INDEX marketing_events_created_at_idx ON public.marketing_events (created_at DESC);
CREATE INDEX marketing_events_order_idx ON public.marketing_events (order_id);
GRANT SELECT ON public.marketing_events TO authenticated;
GRANT ALL ON public.marketing_events TO service_role;
ALTER TABLE public.marketing_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read marketing events"
  ON public.marketing_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 3) marketing_attribution ----------------------------------------------------
CREATE TABLE public.marketing_attribution (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  visitor_id text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  fbclid text,
  gclid text,
  landing_page text,
  referrer text,
  first_touch jsonb,
  last_touch jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX marketing_attribution_visitor_key ON public.marketing_attribution (visitor_id);
CREATE INDEX marketing_attribution_user_idx ON public.marketing_attribution (user_id);
GRANT SELECT, INSERT, UPDATE ON public.marketing_attribution TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.marketing_attribution TO anon;
GRANT ALL ON public.marketing_attribution TO service_role;
ALTER TABLE public.marketing_attribution ENABLE ROW LEVEL SECURITY;
-- Anonymous visitors write their own row keyed by client-generated visitor_id.
-- Once a user signs in the server links user_id via service role.
CREATE POLICY "Attribution readable by admins"
  ON public.marketing_attribution FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR user_id = auth.uid());
CREATE POLICY "Anyone can seed attribution"
  ON public.marketing_attribution FOR INSERT TO anon, authenticated
  WITH CHECK (true);
CREATE POLICY "Anyone can update own attribution row"
  ON public.marketing_attribution FOR UPDATE TO anon, authenticated
  USING (true) WITH CHECK (true);

-- 4) consent_choices ----------------------------------------------------------
CREATE TABLE public.consent_choices (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  visitor_id text NOT NULL UNIQUE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  essential boolean NOT NULL DEFAULT true,
  analytics boolean NOT NULL DEFAULT false,
  marketing boolean NOT NULL DEFAULT false,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.consent_choices TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.consent_choices TO anon;
GRANT ALL ON public.consent_choices TO service_role;
ALTER TABLE public.consent_choices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Consent readable by owner or admin"
  ON public.consent_choices FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR user_id = auth.uid());
CREATE POLICY "Anyone can insert consent"
  ON public.consent_choices FOR INSERT TO anon, authenticated
  WITH CHECK (true);
CREATE POLICY "Anyone can update consent"
  ON public.consent_choices FOR UPDATE TO anon, authenticated
  USING (true) WITH CHECK (true);
CREATE TRIGGER trg_consent_choices_touch
  BEFORE UPDATE ON public.consent_choices
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- 5) tool_orders.attribution --------------------------------------------------
ALTER TABLE public.tool_orders
  ADD COLUMN IF NOT EXISTS attribution jsonb;

-- 6) site_settings.marketing_pause -------------------------------------------
ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS marketing_pause boolean NOT NULL DEFAULT false;
