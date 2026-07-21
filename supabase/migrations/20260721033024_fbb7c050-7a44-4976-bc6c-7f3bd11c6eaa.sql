
-- Transactions & receipts foundation.
ALTER TABLE public.tool_payments
  ADD COLUMN IF NOT EXISTS initiated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS payment_channel text,
  ADD COLUMN IF NOT EXISTS customer_email text,
  ADD COLUMN IF NOT EXISTS customer_name text,
  ADD COLUMN IF NOT EXISTS access_type text,
  ADD COLUMN IF NOT EXISTS billing_period text,
  ADD COLUMN IF NOT EXISTS price_label text,
  ADD COLUMN IF NOT EXISTS paystack_status text,
  ADD COLUMN IF NOT EXISTS paystack_last_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS receipt_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS receipt_last_status text,
  ADD COLUMN IF NOT EXISTS receipt_last_error text,
  ADD COLUMN IF NOT EXISTS reconciliation_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS reconciliation_note text,
  ADD COLUMN IF NOT EXISTS flagged_at timestamptz,
  ADD COLUMN IF NOT EXISTS flagged_reason text,
  ADD COLUMN IF NOT EXISTS last_status_change_at timestamptz;

-- Widen payment_status enum to include the statuses receipts need.
ALTER TABLE public.tool_payments
  DROP CONSTRAINT IF EXISTS tool_payments_payment_status_check;
ALTER TABLE public.tool_payments
  ADD CONSTRAINT tool_payments_payment_status_check
  CHECK (payment_status = ANY (ARRAY[
    'initiated','pending','processing','successful','failed',
    'requires_review','refunded','reversed','abandoned'
  ]));

ALTER TABLE public.tool_payments
  ADD CONSTRAINT tool_payments_reconciliation_check
  CHECK (reconciliation_status = ANY (ARRAY['none','open','investigating','resolved','refunded']));

-- One canonical row per Paystack reference (nullable for offline manual rows).
CREATE UNIQUE INDEX IF NOT EXISTS tool_payments_paystack_reference_unique
  ON public.tool_payments (paystack_reference)
  WHERE paystack_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS tool_payments_status_idx
  ON public.tool_payments (payment_status);
CREATE INDEX IF NOT EXISTS tool_payments_recon_idx
  ON public.tool_payments (reconciliation_status)
  WHERE reconciliation_status <> 'none';

-- Status history: append-only audit trail.
CREATE TABLE IF NOT EXISTS public.tool_payment_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.tool_payments(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  source text NOT NULL, -- checkout | webhook | verify | recheck | admin | system
  paystack_status text,
  note text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.tool_payment_status_history TO authenticated;
GRANT ALL ON public.tool_payment_status_history TO service_role;

ALTER TABLE public.tool_payment_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "history owner or admin select" ON public.tool_payment_status_history
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.tool_payments p
      WHERE p.id = payment_id AND p.user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS tool_payment_status_history_payment_idx
  ON public.tool_payment_status_history(payment_id, created_at DESC);
