
-- Phase 3: Admin WhatsApp number for Private fulfilment and 6-hour fulfilment tracking columns.

ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS admin_whatsapp_number TEXT;

ALTER TABLE public.tool_orders
  ADD COLUMN IF NOT EXISTS fulfilment_deadline_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subscription_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auto_fulfilled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fulfilled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fulfilment_marked_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS fulfilment_reason TEXT;

CREATE INDEX IF NOT EXISTS tool_orders_fulfilment_deadline_idx
  ON public.tool_orders (fulfilment_deadline_at)
  WHERE fulfilment_status = 'pending';
