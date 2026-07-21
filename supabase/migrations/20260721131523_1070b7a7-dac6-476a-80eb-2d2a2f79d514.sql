
-- Seed the admin_alert email template used by Access Health notifications.
INSERT INTO public.email_templates (key, name, subject, html_body, enabled, is_system) VALUES
('admin_alert', 'Access Health alert', 'Access Alert: {{title}}',
'<p>Hi Admin,</p>
<p>An <strong>{{level}}</strong> alert was raised on <strong>{{tool_slug}}</strong>{{account_line}}.</p>
<h3 style="margin:16px 0 8px;font-size:15px;">{{title}}</h3>
<p>{{body}}</p>
<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:13px;margin-top:8px;">
  <tr><td style="color:#64748b;">Tool</td><td>{{tool_slug}}</td></tr>
  <tr><td style="color:#64748b;">Account</td><td>{{account_label}}</td></tr>
  <tr><td style="color:#64748b;">Severity</td><td>{{level}}</td></tr>
  <tr><td style="color:#64748b;">Affected customers</td><td>{{affected_customers}}</td></tr>
  <tr><td style="color:#64748b;">Raised at</td><td>{{raised_at}}</td></tr>
</table>
<p style="margin-top:16px;"><a href="{{admin_link}}" style="background:#2563eb;color:#fff;padding:9px 14px;border-radius:8px;text-decoration:none;display:inline-block;">Open Access Health</a></p>
<p style="color:#64748b;font-size:12px;margin-top:16px;">This notification contains no customer credentials, logins, passwords, or payment information.</p>',
true, true)
ON CONFLICT (key) DO NOTHING;

-- Ensure admin_alert appears in the enabled_types map (default + existing row).
ALTER TABLE public.email_settings
  ALTER COLUMN enabled_types SET DEFAULT '{
    "payment_success": true,
    "payment_failed": true,
    "abandoned_checkout": true,
    "offline_confirmed": true,
    "private_pending": true,
    "private_fulfilled": true,
    "renewal_success": true,
    "renewal_failed": true,
    "renewal_disabled": true,
    "customer_invite": true,
    "admin_alert": true
  }'::jsonb;

UPDATE public.email_settings
  SET enabled_types = enabled_types || jsonb_build_object('admin_alert', true)
  WHERE (enabled_types ? 'admin_alert') IS NOT TRUE;
