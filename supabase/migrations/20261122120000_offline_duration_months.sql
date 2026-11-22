-- Admin-assigned access can now be 1-12 calendar months.
-- 1) Exact length in months is stored on the order.
-- 2) billing_period keeps monthly / quarterly / yearly for 1, 3 and 12 months and
--    gains 'half_yearly' (6 months) and 'custom' (any other whole number of months).
ALTER TABLE public.tool_orders
  ADD COLUMN IF NOT EXISTS duration_months integer
    CHECK (duration_months IS NULL OR (duration_months BETWEEN 1 AND 12));

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.tool_orders'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%billing_period%'
  LOOP
    EXECUTE format('ALTER TABLE public.tool_orders DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.tool_orders
  ADD CONSTRAINT tool_orders_billing_period_check
  CHECK (billing_period IS NULL OR billing_period IN ('monthly','quarterly','yearly','half_yearly','custom'));
