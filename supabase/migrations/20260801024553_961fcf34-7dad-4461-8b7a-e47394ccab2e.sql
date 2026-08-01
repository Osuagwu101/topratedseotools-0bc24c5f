ALTER TABLE public.tool_orders
  ADD COLUMN IF NOT EXISTS display_currency text,
  ADD COLUMN IF NOT EXISTS display_amount numeric;

ALTER TABLE public.tool_payments
  ADD COLUMN IF NOT EXISTS display_currency text,
  ADD COLUMN IF NOT EXISTS display_amount numeric;

ALTER TABLE public.currency_settings
  ADD COLUMN IF NOT EXISTS merchant_currencies text[] NOT NULL DEFAULT ARRAY['NGN']::text[];

COMMENT ON COLUMN public.tool_orders.display_currency IS 'Currency shown to the customer (may differ from the Paystack charge currency).';
COMMENT ON COLUMN public.tool_orders.display_amount IS 'Amount shown to the customer in display_currency.';
COMMENT ON COLUMN public.currency_settings.merchant_currencies IS 'Currencies the Paystack merchant account can actually charge.';