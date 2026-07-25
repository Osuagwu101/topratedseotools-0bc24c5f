CREATE TABLE public.payment_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  display_name text NOT NULL,
  environment text NOT NULL DEFAULT 'test' CHECK (environment IN ('test','live')),
  public_key text,
  webhook_secret_hint text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT false,
  last_test_at timestamptz,
  last_test_status text,
  last_test_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_providers TO authenticated;
GRANT ALL ON public.payment_providers TO service_role;

ALTER TABLE public.payment_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payment_providers admin select" ON public.payment_providers
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "payment_providers admin write" ON public.payment_providers
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER touch_payment_providers
BEFORE UPDATE ON public.payment_providers
FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- Ensure only one active provider at a time
CREATE UNIQUE INDEX payment_providers_only_one_active
ON public.payment_providers ((true))
WHERE is_active = true;

-- Seed Paystack as the default provider
INSERT INTO public.payment_providers (slug, display_name, environment, enabled, is_active, config)
VALUES (
  'paystack',
  'Paystack',
  'live',
  true,
  true,
  jsonb_build_object('supports_recurring', true, 'currency', 'NGN')
)
ON CONFLICT (slug) DO NOTHING;