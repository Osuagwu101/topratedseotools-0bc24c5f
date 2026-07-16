
ALTER TABLE public.tool_pricing
  ADD COLUMN IF NOT EXISTS duration_days integer,
  ADD COLUMN IF NOT EXISTS grace_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS warning_days integer NOT NULL DEFAULT 0;

UPDATE public.tool_pricing SET
  duration_days = COALESCE(duration_days, CASE
    WHEN unit ILIKE '%year%' OR unit ILIKE '%annual%' THEN 365
    WHEN unit ILIKE '%3 month%' OR unit ILIKE '%quarter%' THEN 90
    WHEN unit ILIKE '%month%' THEN 28
    WHEN unit ILIKE '%week%' THEN 7
    ELSE 28 END),
  grace_days = CASE
    WHEN unit ILIKE '%month%' AND unit NOT ILIKE '%3 month%' THEN 2
    ELSE 0 END,
  warning_days = CASE
    WHEN unit ILIKE '%year%' OR unit ILIKE '%annual%' OR unit ILIKE '%3 month%' OR unit ILIKE '%quarter%' THEN 7
    WHEN unit ILIKE '%month%' THEN 2
    ELSE 0 END
WHERE contact_admin = false;

ALTER TABLE public.tool_settings
  ADD COLUMN IF NOT EXISTS login_email text,
  ADD COLUMN IF NOT EXISTS login_password text,
  ADD COLUMN IF NOT EXISTS login_url text,
  ADD COLUMN IF NOT EXISTS login_notes text;

ALTER TABLE public.tool_orders
  ADD COLUMN IF NOT EXISTS paystack_reference text UNIQUE,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS duration_days integer,
  ADD COLUMN IF NOT EXISTS grace_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS warning_days integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS tool_orders_paystack_ref_idx ON public.tool_orders(paystack_reference);
