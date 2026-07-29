
-- 1. currency_settings singleton
CREATE TABLE public.currency_settings (
  id boolean NOT NULL PRIMARY KEY DEFAULT true CHECK (id = true),
  switching_enabled boolean NOT NULL DEFAULT true,
  surcharge_enabled boolean NOT NULL DEFAULT true,
  surcharge_percent numeric(6,3) NOT NULL DEFAULT 3.000,
  supported_currencies text[] NOT NULL DEFAULT ARRAY['NGN','GHS','KES','ZAR','USD'],
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.currency_settings TO anon, authenticated;
GRANT ALL ON public.currency_settings TO service_role;
ALTER TABLE public.currency_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "currency_settings readable by all" ON public.currency_settings FOR SELECT USING (true);
CREATE POLICY "currency_settings admin update" ON public.currency_settings
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "currency_settings admin insert" ON public.currency_settings
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));
INSERT INTO public.currency_settings(id) VALUES (true) ON CONFLICT DO NOTHING;

-- 2. exchange_rates
CREATE TABLE public.exchange_rates (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  base_currency text NOT NULL DEFAULT 'NGN',
  quote_currency text NOT NULL,
  rate numeric(20,10) NOT NULL,
  source text NOT NULL DEFAULT 'exchangerate.host',
  fetched_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (base_currency, quote_currency)
);
GRANT SELECT ON public.exchange_rates TO anon, authenticated;
GRANT ALL ON public.exchange_rates TO service_role;
ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "exchange_rates readable by all" ON public.exchange_rates FOR SELECT USING (true);
CREATE POLICY "exchange_rates admin write" ON public.exchange_rates
  FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- 3. exchange_rate_logs (append-only)
CREATE TABLE public.exchange_rate_logs (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  base_currency text NOT NULL DEFAULT 'NGN',
  quote_currency text NOT NULL,
  rate numeric(20,10) NOT NULL,
  source text NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.exchange_rate_logs TO authenticated;
GRANT ALL ON public.exchange_rate_logs TO service_role;
ALTER TABLE public.exchange_rate_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "exchange_rate_logs admin read" ON public.exchange_rate_logs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- 4. tool_payments currency fields
ALTER TABLE public.tool_payments
  ADD COLUMN IF NOT EXISTS base_amount_ngn numeric(14,2),
  ADD COLUMN IF NOT EXISTS payment_currency text NOT NULL DEFAULT 'NGN',
  ADD COLUMN IF NOT EXISTS exchange_rate numeric(20,10),
  ADD COLUMN IF NOT EXISTS converted_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS international_fee_percent numeric(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS international_fee_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_amount numeric(14,2);

-- 5. tool_orders currency fields
ALTER TABLE public.tool_orders
  ADD COLUMN IF NOT EXISTS payment_currency text NOT NULL DEFAULT 'NGN',
  ADD COLUMN IF NOT EXISTS exchange_rate_snapshot numeric(20,10),
  ADD COLUMN IF NOT EXISTS international_fee_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_amount_charged numeric(14,2);

-- 6. subscription currency
ALTER TABLE public.user_subscriptions
  ADD COLUMN IF NOT EXISTS subscription_currency text NOT NULL DEFAULT 'NGN',
  ADD COLUMN IF NOT EXISTS renewal_currency text NOT NULL DEFAULT 'NGN';

ALTER TABLE public.paystack_plan_mappings
  ADD COLUMN IF NOT EXISTS subscription_currency text NOT NULL DEFAULT 'NGN';

CREATE TRIGGER currency_settings_touch BEFORE UPDATE ON public.currency_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
CREATE TRIGGER exchange_rates_touch BEFORE UPDATE ON public.exchange_rates
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
