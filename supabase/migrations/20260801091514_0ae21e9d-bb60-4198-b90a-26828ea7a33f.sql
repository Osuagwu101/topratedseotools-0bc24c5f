ALTER TABLE public.tool_payments DROP CONSTRAINT IF EXISTS tool_payments_source_check;
ALTER TABLE public.tool_payments
  ADD CONSTRAINT tool_payments_source_check
  CHECK (source = ANY (ARRAY['paystack'::text, 'flutterwave'::text, 'monnify'::text, 'offline'::text]));