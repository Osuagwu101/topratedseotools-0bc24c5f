
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'auto-fulfil-private-orders',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--4f4632d6-30e9-428a-b31e-ec81b5b680a6.lovable.app/api/public/hooks/auto-fulfil-private',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
