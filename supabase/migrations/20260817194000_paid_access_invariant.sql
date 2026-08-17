-- Purchased access must never become active before payment has been verified.
-- Gateway/offline verification updates status and payment_status together, so
-- legitimate successful payments continue to activate immediately.

create or replace function public.enforce_paid_order_approval()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status::text = 'approved'
     and coalesce(new.payment_status::text, 'pending') <> 'successful' then
    raise exception 'Cannot approve an order until payment_status is successful';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_paid_order_approval() from public, anon, authenticated;

drop trigger if exists trg_enforce_paid_order_approval on public.tool_orders;
create trigger trg_enforce_paid_order_approval
before insert or update of status, payment_status on public.tool_orders
for each row execute function public.enforce_paid_order_approval();

create or replace function public.user_has_tool_access(_user_id uuid, _slug text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tool_orders
    where user_id = _user_id
      and tool_slug = _slug
      and status::text = 'approved'
      and payment_status::text = 'successful'
      and (expires_at is null or expires_at > now())
  );
$$;

-- This is a customer-scoped read helper. Keep it callable only by signed-in
-- users and service-role; anon/public do not need it.
revoke all on function public.user_has_tool_access(uuid, text) from public, anon;
grant execute on function public.user_has_tool_access(uuid, text) to authenticated, service_role;
