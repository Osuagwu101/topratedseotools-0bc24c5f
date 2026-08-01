-- Coupons: NGN is the source of truth for all discounts.
CREATE TABLE IF NOT EXISTS public.coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  description text,
  discount_type text NOT NULL DEFAULT 'percent' CHECK (discount_type IN ('percent','amount')),
  discount_value numeric(12,2) NOT NULL CHECK (discount_value > 0),
  currency text NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  tool_slug text,
  access_type text CHECK (access_type IN ('shared','private')),
  billing_period text CHECK (billing_period IN ('monthly','quarterly','yearly')),
  min_amount_ngn numeric(12,2),
  max_redemptions integer,
  max_per_user integer NOT NULL DEFAULT 1,
  redemptions_count integer NOT NULL DEFAULT 0,
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS coupons_code_key ON public.coupons (upper(code));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.coupons TO authenticated;
GRANT ALL ON public.coupons TO service_role;
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage coupons" ON public.coupons;
CREATE POLICY "Admins manage coupons" ON public.coupons
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS coupons_touch ON public.coupons;
CREATE TRIGGER coupons_touch BEFORE UPDATE ON public.coupons
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.coupon_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id uuid NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  coupon_code text NOT NULL,
  user_id uuid NOT NULL,
  order_id uuid NOT NULL,
  discount_amount_ngn numeric(12,2) NOT NULL DEFAULT 0,
  base_amount_ngn numeric(12,2),
  payment_currency text,
  final_amount numeric(12,2),
  paystack_reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS coupon_redemptions_order_key ON public.coupon_redemptions (order_id);
CREATE INDEX IF NOT EXISTS coupon_redemptions_user_idx ON public.coupon_redemptions (coupon_id, user_id);

GRANT SELECT ON public.coupon_redemptions TO authenticated;
GRANT ALL ON public.coupon_redemptions TO service_role;
ALTER TABLE public.coupon_redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own redemptions" ON public.coupon_redemptions;
CREATE POLICY "Users view own redemptions" ON public.coupon_redemptions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- Order + payment records carry the coupon snapshot so display, charge,
-- verification and reporting all read the same numbers.
ALTER TABLE public.tool_orders
  ADD COLUMN IF NOT EXISTS coupon_id uuid,
  ADD COLUMN IF NOT EXISTS coupon_code text,
  ADD COLUMN IF NOT EXISTS discount_amount_ngn numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discounted_amount_ngn numeric(12,2);

ALTER TABLE public.tool_payments
  ADD COLUMN IF NOT EXISTS coupon_code text,
  ADD COLUMN IF NOT EXISTS discount_amount_ngn numeric(12,2) NOT NULL DEFAULT 0;

-- Atomic redemption recorder: increments usage once per order.
CREATE OR REPLACE FUNCTION public.record_coupon_redemption(
  _order_id uuid,
  _paystack_reference text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE o RECORD;
BEGIN
  SELECT id, user_id, coupon_id, coupon_code, discount_amount_ngn,
         discounted_amount_ngn, price_amount, payment_currency, final_amount_charged
    INTO o
    FROM public.tool_orders
    WHERE id = _order_id
    FOR UPDATE;
  IF NOT FOUND OR o.coupon_id IS NULL THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.coupon_redemptions WHERE order_id = _order_id) THEN
    RETURN false;
  END IF;

  INSERT INTO public.coupon_redemptions
    (coupon_id, coupon_code, user_id, order_id, discount_amount_ngn,
     base_amount_ngn, payment_currency, final_amount, paystack_reference)
  VALUES
    (o.coupon_id, o.coupon_code, o.user_id, o.id, COALESCE(o.discount_amount_ngn, 0),
     COALESCE(o.discounted_amount_ngn, o.price_amount), o.payment_currency,
     o.final_amount_charged, _paystack_reference);

  UPDATE public.coupons
    SET redemptions_count = redemptions_count + 1
    WHERE id = o.coupon_id;

  RETURN true;
END; $$;

REVOKE ALL ON FUNCTION public.record_coupon_redemption(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_coupon_redemption(uuid, text) TO service_role;