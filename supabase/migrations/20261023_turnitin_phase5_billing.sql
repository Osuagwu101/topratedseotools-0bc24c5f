BEGIN;
CREATE TABLE IF NOT EXISTS public.turnitin_postpaid_invoices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 invoice_ref text NOT NULL UNIQUE,
 user_id uuid NOT NULL,
 period_start date NOT NULL,
 period_end date NOT NULL,
 amount_due_ngn numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount_due_ngn >= 0),
 status text NOT NULL DEFAULT 'not_due' CHECK (status IN ('not_due','due','partially_paid','overdue','settled','voided')),
 issued_at timestamptz NOT NULL DEFAULT now(),
 due_at timestamptz NULL,
 created_by uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT turnitin_postpaid_invoice_period_check CHECK (period_end > period_start),
 CONSTRAINT turnitin_postpaid_invoice_customer_period UNIQUE (user_id,period_start,period_end)
);
CREATE TABLE IF NOT EXISTS public.turnitin_postpaid_invoice_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 invoice_id uuid NOT NULL REFERENCES public.turnitin_postpaid_invoices(id),
 charge_id uuid NOT NULL UNIQUE REFERENCES public.turnitin_postpaid_charges(id),
 rate_ngn_at_use numeric(14,2) NOT NULL CHECK (rate_ngn_at_use >= 0),
 amount_ngn numeric(14,2) NOT NULL CHECK (amount_ngn >= 0),
 job_id uuid,
 used_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS turnitin_postpaid_invoice_lines_invoice_idx ON public.turnitin_postpaid_invoice_lines(invoice_id);
CREATE TABLE IF NOT EXISTS public.turnitin_postpaid_billing_settings (
 user_id uuid PRIMARY KEY,
 billing_period text NOT NULL DEFAULT 'monthly' CHECK (billing_period IN ('monthly')),
 due_days integer NULL CHECK (due_days IS NULL OR (due_days BETWEEN 0 AND 365)),
 updated_by uuid,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.turnitin_postpaid_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.turnitin_postpaid_invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.turnitin_postpaid_billing_settings ENABLE ROW LEVEL SECURITY;
DO $pol$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='turnitin_postpaid_invoices' AND policyname='postpaid_invoices_read') THEN
 CREATE POLICY postpaid_invoices_read ON public.turnitin_postpaid_invoices FOR SELECT TO authenticated USING (user_id = (select auth.uid()) OR (select public.has_role(auth.uid(),'admin')));
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='turnitin_postpaid_invoice_lines' AND policyname='postpaid_invoice_lines_read') THEN
 CREATE POLICY postpaid_invoice_lines_read ON public.turnitin_postpaid_invoice_lines FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.turnitin_postpaid_invoices i WHERE i.id=invoice_id AND (i.user_id=(select auth.uid()) OR (select public.has_role(auth.uid(),'admin')))));
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='turnitin_postpaid_billing_settings' AND policyname='postpaid_billing_settings_read') THEN
 CREATE POLICY postpaid_billing_settings_read ON public.turnitin_postpaid_billing_settings FOR SELECT TO authenticated USING (user_id=(select auth.uid()) OR (select public.has_role(auth.uid(),'admin')));
 END IF;
END $pol$;
REVOKE ALL ON public.turnitin_postpaid_invoices,public.turnitin_postpaid_invoice_lines,public.turnitin_postpaid_billing_settings FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.turnitin_postpaid_invoices,public.turnitin_postpaid_invoice_lines,public.turnitin_postpaid_billing_settings TO authenticated;
GRANT ALL ON public.turnitin_postpaid_invoices,public.turnitin_postpaid_invoice_lines,public.turnitin_postpaid_billing_settings TO service_role;
CREATE OR REPLACE FUNCTION public.turnitin_generate_postpaid_invoice(_user_id uuid,_period_start date,_period_end date,_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE _invoice uuid; _total numeric(14,2); _ref text;
BEGIN
 IF _user_id IS NULL OR _actor IS NULL OR _period_start IS NULL OR _period_end IS NULL OR _period_start >= _period_end THEN
  RAISE EXCEPTION 'TURNITIN_INVOICE_INVALID_ARGUMENTS';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(_user_id::text || ':' || _period_start::text || ':' || _period_end::text,0));
 SELECT id INTO _invoice FROM public.turnitin_postpaid_invoices WHERE user_id=_user_id AND period_start=_period_start AND period_end=_period_end;
 IF FOUND THEN RETURN _invoice; END IF;
 PERFORM c.id FROM public.turnitin_postpaid_charges c
 WHERE c.user_id=_user_id AND c.status <> 'void' AND c.charged_at >= _period_start::timestamptz AND c.charged_at < _period_end::timestamptz
 ORDER BY c.id FOR UPDATE;
 SELECT coalesce(sum(c.amount_ngn),0)::numeric(14,2) INTO _total FROM public.turnitin_postpaid_charges c
 WHERE c.user_id=_user_id AND c.status <> 'void' AND c.charged_at >= _period_start::timestamptz AND c.charged_at < _period_end::timestamptz
 AND NOT EXISTS (SELECT 1 FROM public.turnitin_postpaid_invoice_lines l WHERE l.charge_id=c.id);
 _invoice := gen_random_uuid();
 _ref := 'TPI-' || upper(replace(_invoice::text,'-',''));
 INSERT INTO public.turnitin_postpaid_invoices(id,invoice_ref,user_id,period_start,period_end,amount_due_ngn,status,created_by)
 VALUES(_invoice,_ref,_user_id,_period_start,_period_end,_total,'not_due',_actor);
 INSERT INTO public.turnitin_postpaid_invoice_lines(invoice_id,charge_id,rate_ngn_at_use,amount_ngn,job_id,used_at)
 SELECT _invoice,c.id,c.rate_ngn,c.amount_ngn,c.job_id,c.charged_at
 FROM public.turnitin_postpaid_charges c
 WHERE c.user_id=_user_id AND c.status <> 'void' AND c.charged_at >= _period_start::timestamptz AND c.charged_at < _period_end::timestamptz
 AND NOT EXISTS (SELECT 1 FROM public.turnitin_postpaid_invoice_lines l WHERE l.charge_id=c.id);
 RETURN _invoice;
END;
$fn$;
REVOKE ALL ON FUNCTION public.turnitin_generate_postpaid_invoice(uuid,date,date,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.turnitin_generate_postpaid_invoice(uuid,date,date,uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.turnitin_postpaid_statement(_user_id uuid,_from date,_to date)
RETURNS TABLE(opening_balance_ngn numeric,charges_ngn numeric,settlements_ngn numeric,voids_ngn numeric,closing_balance_ngn numeric,outstanding_ngn numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $fn$
WITH sums AS (
 SELECT
 coalesce((SELECT sum(c.amount_ngn) FROM public.turnitin_postpaid_charges c WHERE c.user_id=_user_id AND c.charged_at < _from::timestamptz),0)::numeric historic_charges,
 coalesce((SELECT sum(c.amount_ngn) FROM public.turnitin_postpaid_charges c WHERE c.user_id=_user_id AND c.status='void' AND c.voided_at < _from::timestamptz),0)::numeric historic_voids,
 coalesce((SELECT sum(s.amount_ngn) FROM public.turnitin_postpaid_settlements s WHERE s.user_id=_user_id AND s.status='confirmed' AND s.confirmed_at < _from::timestamptz),0)::numeric historic_settlements,
 coalesce((SELECT sum(c.amount_ngn) FROM public.turnitin_postpaid_charges c WHERE c.user_id=_user_id AND c.charged_at >= _from::timestamptz AND c.charged_at < _to::timestamptz),0)::numeric period_charges,
 coalesce((SELECT sum(c.amount_ngn) FROM public.turnitin_postpaid_charges c WHERE c.user_id=_user_id AND c.status='void' AND c.voided_at >= _from::timestamptz AND c.voided_at < _to::timestamptz),0)::numeric period_voids,
 coalesce((SELECT sum(s.amount_ngn) FROM public.turnitin_postpaid_settlements s WHERE s.user_id=_user_id AND s.status='confirmed' AND s.confirmed_at >= _from::timestamptz AND s.confirmed_at < _to::timestamptz),0)::numeric period_settlements,
 coalesce((SELECT sum(c.amount_ngn-c.paid_amount_ngn) FROM public.turnitin_postpaid_charges c WHERE c.user_id=_user_id AND c.status <> 'void'),0)::numeric open_charges
)
SELECT historic_charges-historic_voids-historic_settlements,period_charges,period_settlements,period_voids,
(historic_charges-historic_voids-historic_settlements)+period_charges-period_voids-period_settlements,
open_charges FROM sums WHERE _user_id IS NOT NULL AND _from IS NOT NULL AND _to IS NOT NULL AND _from < _to;
$fn$;
REVOKE ALL ON FUNCTION public.turnitin_postpaid_statement(uuid,date,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.turnitin_postpaid_statement(uuid,date,date) TO authenticated,service_role;
COMMIT;