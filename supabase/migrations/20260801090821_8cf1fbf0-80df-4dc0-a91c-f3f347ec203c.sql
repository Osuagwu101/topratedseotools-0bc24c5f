ALTER TABLE public.tool_orders
  ADD COLUMN IF NOT EXISTS payment_gateway text NOT NULL DEFAULT 'paystack',
  ADD COLUMN IF NOT EXISTS gateway_transaction_reference text,
  ADD COLUMN IF NOT EXISTS gateway_response jsonb;

ALTER TABLE public.tool_payments
  ADD COLUMN IF NOT EXISTS payment_gateway text NOT NULL DEFAULT 'paystack',
  ADD COLUMN IF NOT EXISTS gateway_transaction_reference text,
  ADD COLUMN IF NOT EXISTS gateway_response jsonb;

ALTER TABLE public.paystack_webhook_events
  ADD COLUMN IF NOT EXISTS gateway text NOT NULL DEFAULT 'paystack';

CREATE INDEX IF NOT EXISTS tool_payments_gateway_ref_idx
  ON public.tool_payments (payment_gateway, gateway_transaction_reference);
CREATE INDEX IF NOT EXISTS tool_orders_gateway_idx
  ON public.tool_orders (payment_gateway);

INSERT INTO public.payment_providers (slug, display_name, environment, enabled, is_active, config)
VALUES
  ('flutterwave', 'Flutterwave', 'live', false, false, '{"currency":"NGN","supports_recurring":false}'::jsonb),
  ('monnify', 'Monnify', 'live', false, false, '{"currency":"NGN","supports_recurring":false,"contract_code":null,"base_url":"https://api.monnify.com"}'::jsonb)
ON CONFLICT (slug) DO NOTHING;