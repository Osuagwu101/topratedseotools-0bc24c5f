UPDATE public.email_settings
SET resend_domain_id = '4b69aba7-b488-488f-8f5f-0c2f72001614',
    resend_domain_status = 'verified',
    last_verified_at = now()
WHERE id = true;

SELECT cron.unschedule('auto-fulfil-private-orders');

SELECT cron.schedule(
  'auto-fulfil-private-orders',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--4f4632d6-30e9-428a-b31e-ec81b5b680a6.lovable.app/api/public/hooks/auto-fulfil-private',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-cron-secret', (SELECT value FROM public.internal_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);