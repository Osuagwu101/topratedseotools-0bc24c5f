
-- =========================================================================
-- Phase 1B: Non-destructive recurring-billing schema foundation
-- All changes are additive. No existing data, columns, enums, or policies
-- are removed or renamed.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. tool_pricing: add billing_period (monthly / quarterly / yearly)
-- -------------------------------------------------------------------------
ALTER TABLE public.tool_pricing
  ADD COLUMN IF NOT EXISTS billing_period text
    CHECK (billing_period IS NULL OR billing_period IN ('monthly','quarterly','yearly'));

-- Backfill only unambiguous durations. Leave others null.
UPDATE public.tool_pricing SET billing_period = 'monthly'   WHERE billing_period IS NULL AND duration_days = 28;
UPDATE public.tool_pricing SET billing_period = 'quarterly' WHERE billing_period IS NULL AND duration_days = 90;
UPDATE public.tool_pricing SET billing_period = 'yearly'    WHERE billing_period IS NULL AND duration_days = 365;

-- -------------------------------------------------------------------------
-- 2. tool_orders: additive classification + recurring/pay-per-unit fields
-- -------------------------------------------------------------------------
ALTER TABLE public.tool_orders
  ADD COLUMN IF NOT EXISTS access_type text
    CHECK (access_type IS NULL OR access_type IN ('shared','private')),
  ADD COLUMN IF NOT EXISTS billing_period text
    CHECK (billing_period IS NULL OR billing_period IN ('monthly','quarterly','yearly')),
  ADD COLUMN IF NOT EXISTS payment_type text NOT NULL DEFAULT 'legacy_one_time'
    CHECK (payment_type IN ('legacy_one_time','one_time','recurring_subscription','pay_per_unit')),
  ADD COLUMN IF NOT EXISTS product_type text NOT NULL DEFAULT 'subscription'
    CHECK (product_type IN ('subscription','service')),
  ADD COLUMN IF NOT EXISTS paystack_environment text NOT NULL DEFAULT 'legacy'
    CHECK (paystack_environment IN ('legacy','test','live')),
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending','processing','successful','failed','requires_review','refunded','reversed')),
  ADD COLUMN IF NOT EXISTS subscription_status text NOT NULL DEFAULT 'not_applicable'
    CHECK (subscription_status IN ('not_applicable','pending','active','past_due','non_renewing','expired','cancelled','suspended')),
  ADD COLUMN IF NOT EXISTS fulfilment_status text NOT NULL DEFAULT 'not_required'
    CHECK (fulfilment_status IN ('not_required','pending','active','failed','expired')),
  ADD COLUMN IF NOT EXISTS renewal_status text NOT NULL DEFAULT 'not_applicable'
    CHECK (renewal_status IN ('not_applicable','enabled','disable_pending','disabled')),
  -- Recurring-subscription storage (nullable, unused for existing rows)
  ADD COLUMN IF NOT EXISTS paystack_customer_code text,
  ADD COLUMN IF NOT EXISTS paystack_subscription_code text,
  ADD COLUMN IF NOT EXISTS paystack_plan_code text,
  ADD COLUMN IF NOT EXISTS current_period_start timestamptz,
  ADD COLUMN IF NOT EXISTS current_period_end timestamptz,
  ADD COLUMN IF NOT EXISTS paid_through_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_payment_at timestamptz,
  ADD COLUMN IF NOT EXISTS non_renewal_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS subscription_disabled_at timestamptz,
  -- Pay-per-unit fields (nullable)
  ADD COLUMN IF NOT EXISTS quantity integer,
  ADD COLUMN IF NOT EXISTS unit_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS verified_total numeric(12,2),
  ADD COLUMN IF NOT EXISTS service_status text;

-- Backfill access_type + billing_period from linked pricing row, only when unambiguous.
UPDATE public.tool_orders o
SET access_type = p.access_type
FROM public.tool_pricing p
WHERE o.pricing_option_id = p.id
  AND o.access_type IS NULL
  AND p.access_type IN ('shared','private');

UPDATE public.tool_orders o
SET billing_period = p.billing_period
FROM public.tool_pricing p
WHERE o.pricing_option_id = p.id
  AND o.billing_period IS NULL
  AND p.billing_period IS NOT NULL;

-- Backfill payment_status for terminal statuses on existing legacy orders.
UPDATE public.tool_orders SET payment_status = 'successful' WHERE status = 'approved' AND payment_status = 'pending';
UPDATE public.tool_orders SET payment_status = 'failed'     WHERE status = 'rejected' AND payment_status = 'pending';

CREATE INDEX IF NOT EXISTS tool_orders_subscription_code_idx
  ON public.tool_orders (paystack_subscription_code)
  WHERE paystack_subscription_code IS NOT NULL;

-- -------------------------------------------------------------------------
-- 3. tool_payments: per-transaction payment history
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tool_payments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.tool_orders(id) ON DELETE SET NULL,
  tool_slug text NOT NULL,
  paystack_reference text,
  paystack_transaction_id text,
  paystack_invoice_code text,
  payment_type text NOT NULL DEFAULT 'one_time'
    CHECK (payment_type IN ('legacy_one_time','one_time','recurring_subscription','pay_per_unit')),
  classification text NOT NULL DEFAULT 'initial'
    CHECK (classification IN ('initial','renewal','one_time','refund','reversal')),
  amount numeric(12,2),
  currency text NOT NULL DEFAULT 'NGN',
  payment_status text NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending','processing','successful','failed','requires_review','refunded','reversed')),
  paid_at timestamptz,
  paystack_environment text NOT NULL DEFAULT 'legacy'
    CHECK (paystack_environment IN ('legacy','test','live')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.tool_payments TO authenticated;
GRANT ALL ON public.tool_payments TO service_role;

ALTER TABLE public.tool_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payments owner select" ON public.tool_payments
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "payments admin write" ON public.tool_payments
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS tool_payments_user_idx ON public.tool_payments (user_id);
CREATE INDEX IF NOT EXISTS tool_payments_order_idx ON public.tool_payments (order_id);
CREATE INDEX IF NOT EXISTS tool_payments_ref_idx ON public.tool_payments (paystack_reference);

CREATE TRIGGER trg_tool_payments_updated
  BEFORE UPDATE ON public.tool_payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- -------------------------------------------------------------------------
-- 4. paystack_customers: per-environment customer mapping
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.paystack_customers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  paystack_environment text NOT NULL
    CHECK (paystack_environment IN ('test','live')),
  paystack_customer_code text NOT NULL,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, paystack_environment)
);

GRANT SELECT ON public.paystack_customers TO authenticated;
GRANT ALL ON public.paystack_customers TO service_role;

ALTER TABLE public.paystack_customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "paystack_customers owner select" ON public.paystack_customers
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "paystack_customers admin write" ON public.paystack_customers
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_paystack_customers_updated
  BEFORE UPDATE ON public.paystack_customers
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- -------------------------------------------------------------------------
-- 5. paystack_plan_mappings: versioned per-pricing plan codes
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.paystack_plan_mappings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pricing_option_id uuid REFERENCES public.tool_pricing(id) ON DELETE SET NULL,
  tool_slug text NOT NULL,
  access_type text NOT NULL CHECK (access_type IN ('shared','private')),
  billing_period text NOT NULL CHECK (billing_period IN ('monthly','quarterly','yearly')),
  paystack_environment text NOT NULL CHECK (paystack_environment IN ('test','live')),
  paystack_plan_code text,
  amount_snapshot numeric(12,2),
  currency text NOT NULL DEFAULT 'NGN',
  paystack_interval text,
  active_for_new_purchases boolean NOT NULL DEFAULT false,
  sync_status text NOT NULL DEFAULT 'pending'
    CHECK (sync_status IN ('pending','synced','error','superseded')),
  sync_error text,
  last_verified_at timestamptz,
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.paystack_plan_mappings TO authenticated;
GRANT ALL ON public.paystack_plan_mappings TO service_role;

ALTER TABLE public.paystack_plan_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "plan_mappings admin all" ON public.paystack_plan_mappings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS plan_mappings_lookup_idx
  ON public.paystack_plan_mappings (tool_slug, access_type, billing_period, paystack_environment, active_for_new_purchases);

CREATE TRIGGER trg_plan_mappings_updated
  BEFORE UPDATE ON public.paystack_plan_mappings
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- -------------------------------------------------------------------------
-- 6. paystack_webhook_events: idempotent event log (prep only; no processing)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.paystack_webhook_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  event_type text NOT NULL,
  transaction_reference text,
  subscription_code text,
  invoice_code text,
  paystack_environment text NOT NULL DEFAULT 'legacy'
    CHECK (paystack_environment IN ('legacy','test','live')),
  processing_status text NOT NULL DEFAULT 'pending'
    CHECK (processing_status IN ('pending','processing','processed','failed','skipped')),
  processing_attempts integer NOT NULL DEFAULT 0,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  last_error text,
  payload_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.paystack_webhook_events TO service_role;
-- Customers cannot read webhook events. Admins access via service_role or the admin dashboard.

ALTER TABLE public.paystack_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "webhook_events admin select" ON public.paystack_webhook_events
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- No write policies for authenticated role: only service_role can insert/update.

CREATE INDEX IF NOT EXISTS webhook_events_ref_idx ON public.paystack_webhook_events (transaction_reference);
CREATE INDEX IF NOT EXISTS webhook_events_sub_idx ON public.paystack_webhook_events (subscription_code);

CREATE TRIGGER trg_webhook_events_updated
  BEFORE UPDATE ON public.paystack_webhook_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
