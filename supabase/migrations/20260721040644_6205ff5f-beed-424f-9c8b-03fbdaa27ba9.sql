
-- =========================================================================
-- email_settings (singleton row, id = true)
-- =========================================================================
CREATE TABLE public.email_settings (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id = true),
  sender_name TEXT NOT NULL DEFAULT 'Top Rated SEO Tools',
  from_email TEXT NOT NULL DEFAULT 'support@topratedseotools.com',
  reply_to_email TEXT NOT NULL DEFAULT 'support@topratedseotools.com',
  sending_domain TEXT NOT NULL DEFAULT 'topratedseotools.com',
  abandoned_delay_hours INTEGER NOT NULL DEFAULT 24 CHECK (abandoned_delay_hours >= 0 AND abandoned_delay_hours <= 720),
  enabled_types JSONB NOT NULL DEFAULT '{
    "payment_success": true,
    "payment_failed": true,
    "abandoned_checkout": true,
    "offline_confirmed": true,
    "private_pending": true,
    "private_fulfilled": true,
    "renewal_success": true,
    "renewal_failed": true,
    "renewal_disabled": true,
    "customer_invite": true
  }'::jsonb,
  production_sending BOOLEAN NOT NULL DEFAULT false,
  resend_domain_id TEXT,
  resend_domain_status TEXT NOT NULL DEFAULT 'unconfigured',
  resend_dns_records JSONB,
  last_verified_at TIMESTAMPTZ,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.email_settings TO authenticated;
GRANT ALL ON public.email_settings TO service_role;
ALTER TABLE public.email_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read email settings" ON public.email_settings
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update email settings" ON public.email_settings
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins insert email settings" ON public.email_settings
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_email_settings_updated_at
  BEFORE UPDATE ON public.email_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- Seed the singleton row
INSERT INTO public.email_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

-- =========================================================================
-- email_templates
-- =========================================================================
CREATE TABLE public.email_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  html_body TEXT NOT NULL,
  text_body TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  is_system BOOLEAN NOT NULL DEFAULT true,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_templates TO authenticated;
GRANT ALL ON public.email_templates TO service_role;
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage email templates" ON public.email_templates
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_email_templates_updated_at
  BEFORE UPDATE ON public.email_templates
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- Seed default templates
INSERT INTO public.email_templates (key, name, subject, html_body) VALUES
('payment_success', 'Payment successful', 'Payment received — {{tool}} access is active',
'<p>Hi {{name}},</p><p>Your payment of <strong>{{currency}} {{amount}}</strong> for <strong>{{tool}}</strong> ({{access_type}}, {{billing_period}}) was successful.</p><p>Reference: {{reference}}<br/>Access starts: {{start_date}}<br/>Expires: {{expiry_date}}</p><p><a href="{{dashboard_url}}">Open your dashboard</a></p><p>— Top Rated SEO Tools</p>'),
('payment_failed', 'Payment failed', 'We couldn''t process your payment for {{tool}}',
'<p>Hi {{name}},</p><p>Unfortunately your payment for <strong>{{tool}}</strong> could not be processed.</p><p>Reference: {{reference}}<br/>Reason: {{reason}}</p><p><a href="{{retry_url}}">Try again</a> or contact us at {{reply_to}}.</p><p>— Top Rated SEO Tools</p>'),
('abandoned_checkout', 'Complete your checkout', 'Still interested in {{tool}}?',
'<p>Hi {{name}},</p><p>You started checkout for <strong>{{tool}}</strong> ({{access_type}}, {{billing_period}} — {{currency}} {{amount}}) but didn''t finish.</p><p><a href="{{resume_url}}">Resume checkout</a></p><p>Need help? Reply to this email.</p><p>— Top Rated SEO Tools</p>'),
('offline_confirmed', 'Offline payment recorded', 'Access confirmed — {{tool}}',
'<p>Hi {{name}},</p><p>We''ve recorded your one-time payment for <strong>{{tool}}</strong>.</p><ul><li>Access: {{access_type}}</li><li>Billing: {{billing_period}}</li><li>Amount: {{currency}} {{amount}}</li><li>Method: {{payment_method}}</li><li>Start: {{start_date}}</li><li>Expiry: {{expiry_date}}</li><li>Auto-renew: {{auto_renew}}</li></ul><p><a href="{{dashboard_url}}">Open your dashboard</a></p><p>— Top Rated SEO Tools</p>'),
('private_pending', 'Private Access — payment received', 'Payment received — Private Access setup in progress',
'<p>Hi {{name}},</p><p>Payment successful for <strong>{{tool}}</strong> (Private Access, {{billing_period}} — {{currency}} {{amount}}).</p><p>Your dedicated credentials are being prepared and will be delivered by <strong>{{fulfil_by}}</strong>.</p><p>{{contact_admin_line}}</p><p>— Top Rated SEO Tools</p>'),
('private_fulfilled', 'Private Access is ready', 'Your Private Access for {{tool}} is ready',
'<p>Hi {{name}},</p><p>Your Private Access credentials for <strong>{{tool}}</strong> are now available in your dashboard.</p><p><a href="{{dashboard_url}}">Launch tool</a></p><p>— Top Rated SEO Tools</p>'),
('renewal_success', 'Subscription renewed', 'Your {{tool}} subscription renewed',
'<p>Hi {{name}},</p><p>Your subscription for <strong>{{tool}}</strong> renewed successfully. Next billing: {{next_billing_date}}.</p><p>— Top Rated SEO Tools</p>'),
('renewal_failed', 'Renewal failed', 'Renewal failed for {{tool}}',
'<p>Hi {{name}},</p><p>We could not renew your <strong>{{tool}}</strong> subscription. Please update your payment method.</p><p><a href="{{billing_url}}">Manage billing</a></p><p>— Top Rated SEO Tools</p>'),
('renewal_disabled', 'Auto-renewal disabled', 'Auto-renewal turned off for {{tool}}',
'<p>Hi {{name}},</p><p>Auto-renewal for <strong>{{tool}}</strong> is now off. Your access continues until {{expiry_date}}.</p><p>— Top Rated SEO Tools</p>'),
('customer_invite', 'Your account is ready', 'Your Top Rated SEO Tools account is ready',
'<p>Hi {{name}},</p><p>An account has been created for you at Top Rated SEO Tools.</p><p><a href="{{setup_url}}">Set your password and sign in</a></p><p>For your security, we don''t include passwords in email.</p><p>— Top Rated SEO Tools</p>')
ON CONFLICT (key) DO NOTHING;

-- =========================================================================
-- email_messages (idempotency + queue + history)
-- =========================================================================
CREATE TABLE public.email_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_key TEXT NOT NULL UNIQUE,
  template_key TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT,
  related_order_id UUID,
  related_user_id UUID,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sent','failed','retrying','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  resend_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX email_messages_status_scheduled_idx
  ON public.email_messages (status, scheduled_for);
CREATE INDEX email_messages_recipient_idx
  ON public.email_messages (recipient);
CREATE INDEX email_messages_order_idx
  ON public.email_messages (related_order_id);
CREATE INDEX email_messages_created_idx
  ON public.email_messages (created_at DESC);

GRANT SELECT ON public.email_messages TO authenticated;
GRANT ALL ON public.email_messages TO service_role;
ALTER TABLE public.email_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read email messages" ON public.email_messages
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update email messages" ON public.email_messages
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_email_messages_updated_at
  BEFORE UPDATE ON public.email_messages
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
