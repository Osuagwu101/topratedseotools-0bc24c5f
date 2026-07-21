
-- 1. Extend tool_orders with offline / admin-origin fields
ALTER TABLE public.tool_orders
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'paystack',
  ADD COLUMN IF NOT EXISTS created_by_admin uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS cancellation_reason text;

DO $$ BEGIN
  ALTER TABLE public.tool_orders
    ADD CONSTRAINT tool_orders_origin_check
    CHECK (origin IN ('paystack','offline'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Extend tool_payments with offline metadata
ALTER TABLE public.tool_payments
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'paystack',
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS reference_note text,
  ADD COLUMN IF NOT EXISTS admin_note text,
  ADD COLUMN IF NOT EXISTS recorded_by uuid REFERENCES auth.users(id);

DO $$ BEGIN
  ALTER TABLE public.tool_payments
    ADD CONSTRAINT tool_payments_source_check
    CHECK (source IN ('paystack','offline'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.tool_payments
    ADD CONSTRAINT tool_payments_payment_method_check
    CHECK (payment_method IS NULL OR payment_method IN (
      'bank_transfer','cash','whatsapp','other'
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Relax paystack_environment check to allow 'offline' marker
ALTER TABLE public.tool_payments
  DROP CONSTRAINT IF EXISTS tool_payments_paystack_environment_check;
ALTER TABLE public.tool_payments
  ADD CONSTRAINT tool_payments_paystack_environment_check
  CHECK (paystack_environment IN ('legacy','test','live','offline'));

ALTER TABLE public.tool_orders
  DROP CONSTRAINT IF EXISTS tool_orders_paystack_environment_check;
ALTER TABLE public.tool_orders
  ADD CONSTRAINT tool_orders_paystack_environment_check
  CHECK (paystack_environment IN ('legacy','test','live','offline'));

-- 3. Admin-only per-customer metadata (phone, notes)
CREATE TABLE IF NOT EXISTS public.customer_admin_meta (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone text,
  admin_notes text,
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_admin_meta TO authenticated;
GRANT ALL ON public.customer_admin_meta TO service_role;

ALTER TABLE public.customer_admin_meta ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin meta read" ON public.customer_admin_meta;
CREATE POLICY "admin meta read"
  ON public.customer_admin_meta
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS "admin meta write" ON public.customer_admin_meta;
CREATE POLICY "admin meta write"
  ON public.customer_admin_meta
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

DROP TRIGGER IF EXISTS trg_customer_admin_meta_updated ON public.customer_admin_meta;
CREATE TRIGGER trg_customer_admin_meta_updated
  BEFORE UPDATE ON public.customer_admin_meta
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- 4. Admin audit log for customer actions
CREATE TABLE IF NOT EXISTS public.customer_admin_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  admin_id uuid REFERENCES auth.users(id),
  action text NOT NULL,
  order_id uuid REFERENCES public.tool_orders(id) ON DELETE SET NULL,
  payment_id uuid REFERENCES public.tool_payments(id) ON DELETE SET NULL,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_admin_audit_customer_idx
  ON public.customer_admin_audit(customer_id, created_at DESC);

GRANT SELECT, INSERT ON public.customer_admin_audit TO authenticated;
GRANT ALL ON public.customer_admin_audit TO service_role;

ALTER TABLE public.customer_admin_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit admin read" ON public.customer_admin_audit;
CREATE POLICY "audit admin read"
  ON public.customer_admin_audit
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS "audit admin write" ON public.customer_admin_audit;
CREATE POLICY "audit admin write"
  ON public.customer_admin_audit
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin'));
