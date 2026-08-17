-- Atomically switch the single active checkout gateway.
-- The application performs Super Admin authentication and live credential
-- validation before invoking this RPC through the service-role client.

create or replace function public.set_active_payment_provider(_provider_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slug text;
begin
  select slug into v_slug
  from public.payment_providers
  where id = _provider_id
  for update;

  if not found then
    raise exception 'Provider not found';
  end if;

  update public.payment_providers
  set is_active = (id = _provider_id),
      enabled = case when id = _provider_id then true else enabled end;

  return v_slug;
end;
$$;

revoke all on function public.set_active_payment_provider(uuid) from public, anon, authenticated;
grant execute on function public.set_active_payment_provider(uuid) to service_role;
