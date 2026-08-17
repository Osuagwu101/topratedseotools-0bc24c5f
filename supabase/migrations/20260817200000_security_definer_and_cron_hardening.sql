-- Restrict privileged SECURITY DEFINER helpers to the roles that actually need them.
revoke all on function public.assign_tool_account_for_order(uuid) from public, anon, authenticated;
grant execute on function public.assign_tool_account_for_order(uuid) to service_role;

revoke all on function public.record_coupon_redemption(uuid, text) from public, anon, authenticated;
grant execute on function public.record_coupon_redemption(uuid, text) to service_role;

revoke all on function public.release_assignments_for_order(uuid, text) from public, anon, authenticated;
grant execute on function public.release_assignments_for_order(uuid, text) to service_role;

revoke all on function public.tg_release_on_order_end() from public, anon, authenticated;
grant execute on function public.tg_release_on_order_end() to service_role;

revoke execute on function public.admin_effective_permission(uuid, text) from anon;

-- The email dispatcher must fetch the shared cron credential from server-only
-- internal_secrets rather than embedding the credential inside cron.job.command.
select cron.alter_job(
  3,
  command := $cmd$
    SELECT net.http_post(
      url := 'https://project--4f4632d6-30e9-428a-b31e-ec81b5b680a6.lovable.app/api/public/hooks/email-dispatcher',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-cron-secret', (SELECT value FROM public.internal_secrets WHERE name = 'cron_secret')
      ),
      body := '{}'::jsonb
    );
  $cmd$
);
