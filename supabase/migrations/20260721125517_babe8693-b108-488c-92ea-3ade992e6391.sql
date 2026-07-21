
-- Access Health alert settings (stored on the singleton site_settings row).
ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS alert_almost_full_pct integer NOT NULL DEFAULT 80,
  ADD COLUMN IF NOT EXISTS alert_expiry_days integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS alert_emails_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS alert_email_recipients text[] NOT NULL DEFAULT ARRAY[]::text[];

-- Log of admin alert emails already sent, keyed by a stable per-issue key
-- so we do not re-notify while an issue is still open.
CREATE TABLE IF NOT EXISTS public.admin_alert_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_key text NOT NULL UNIQUE,
  alert_type text NOT NULL,
  subject text NOT NULL,
  recipient text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_alert_log TO authenticated;
GRANT ALL ON public.admin_alert_log TO service_role;

ALTER TABLE public.admin_alert_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read admin alert log"
  ON public.admin_alert_log FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert admin alert log"
  ON public.admin_alert_log FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update admin alert log"
  ON public.admin_alert_log FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS admin_alert_log_resolved_idx
  ON public.admin_alert_log (resolved_at, alert_key);
