INSERT INTO public.email_messages (event_key, template_key, recipient, payload, status, scheduled_for)
VALUES
 ('prodtest_invite:2026-08-01', 'customer_invite', 'Smartmove1914@gmail.com',
  '{"name":"Smartmove","setup_url":"https://topratedseotools.com/login","site_url":"https://topratedseotools.com"}'::jsonb,
  'pending', now()),
 ('prodtest_payment:2026-08-01', 'payment_success', 'Smartmove1914@gmail.com',
  '{"name":"Smartmove","tool":"Semrush","plan":"Shared access · Monthly","amount":"NGN 10,400","reference":"PRODTEST-2026-08-01","site_url":"https://topratedseotools.com"}'::jsonb,
  'pending', now()),
 ('prodtest_admin:2026-08-01', 'admin_alert', 'Nnaemekasolomon31@gmail.com',
  '{"level":"info","tool_slug":"system","account_line":"","title":"Production email delivery test","body":"This is a live delivery test of the admin alert channel.","site_url":"https://topratedseotools.com"}'::jsonb,
  'pending', now());