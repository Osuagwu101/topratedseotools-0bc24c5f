-- Turnitin V2 Phase 3: Admin manual prepaid credit grants.
-- Isolated from ordinary subscriptions, orders and payment records.

begin;

create table if not exists public.turnitin_admin_credit_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  batch_id uuid not null references public.turnitin_credit_batches(id) on delete restrict,
  quantity integer not null check (quantity > 0 and quantity <= 10000),
  expires_at timestamptz not null,
  reason text not null check (char_length(btrim(reason)) between 3 and 1000),
  granted_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint turnitin_admin_credit_grants_expiry_chk
    check (expires_at > created_at),
  constraint turnitin_admin_credit_grants_batch_uid unique (batch_id)
);

create index if not exists turnitin_admin_credit_grants_user_idx
  on public.turnitin_admin_credit_grants (user_id, created_at desc);

create index if not exists turnitin_admin_credit_grants_actor_idx
  on public.turnitin_admin_credit_grants (granted_by, created_at desc);

alter table public.turnitin_admin_credit_grants enable row level security;

revoke all on table public.turnitin_admin_credit_grants from anon, authenticated;
grant select on table public.turnitin_admin_credit_grants to authenticated;
grant all on table public.turnitin_admin_credit_grants to service_role;

drop policy if exists "turnitin admin grants admin read"
  on public.turnitin_admin_credit_grants;
create policy "turnitin admin grants admin read"
  on public.turnitin_admin_credit_grants
  for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

create or replace function public.turnitin_admin_grant_credits(
  _user_id uuid,
  _quantity integer,
  _expires_at timestamptz,
  _reason text,
  _admin_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _grant_id uuid := gen_random_uuid();
  _batch_id uuid := gen_random_uuid();
  _clean_reason text := btrim(coalesce(_reason, ''));
begin
  if _user_id is null then
    raise exception 'TURNITIN_GRANT_USER_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = _user_id
  ) then
    raise exception 'TURNITIN_GRANT_CUSTOMER_NOT_FOUND';
  end if;

  if _admin_id is null then
    raise exception 'TURNITIN_GRANT_ADMIN_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.user_roles r
    where r.user_id = _admin_id
      and r.role = 'admin'
      and coalesce(r.is_active, true)
  ) then
    raise exception 'TURNITIN_GRANT_ADMIN_FORBIDDEN';
  end if;

  if _quantity is null or _quantity < 1 or _quantity > 10000 then
    raise exception 'TURNITIN_GRANT_QUANTITY_INVALID';
  end if;

  if _expires_at is null or _expires_at <= now() then
    raise exception 'TURNITIN_GRANT_EXPIRY_INVALID';
  end if;

  if char_length(_clean_reason) < 3 or char_length(_clean_reason) > 1000 then
    raise exception 'TURNITIN_GRANT_REASON_INVALID';
  end if;

  insert into public.turnitin_credit_batches (
    id,
    user_id,
    source,
    purchase_id,
    source_job_id,
    granted_credits,
    available_credits,
    reserved_credits,
    consumed_credits,
    expired_credits,
    refunded_credits,
    expires_at,
    note
  )
  values (
    _batch_id,
    _user_id,
    'admin',
    null,
    null,
    _quantity,
    _quantity,
    0,
    0,
    0,
    0,
    _expires_at,
    'Admin-granted Turnitin credits: ' || _clean_reason
  );

  insert into public.turnitin_admin_credit_grants (
    id,
    user_id,
    batch_id,
    quantity,
    expires_at,
    reason,
    granted_by
  )
  values (
    _grant_id,
    _user_id,
    _batch_id,
    _quantity,
    _expires_at,
    _clean_reason,
    _admin_id
  );

  insert into public.turnitin_credit_ledger (
    user_id,
    batch_id,
    event_type,
    available_delta,
    idempotency_key,
    note
  )
  values (
    _user_id,
    _batch_id,
    'grant',
    _quantity,
    'grant-admin:' || _grant_id::text,
    'Admin manual grant: ' || _clean_reason
  );

  perform public.turnitin_expire_user_credits(_user_id);

  return _grant_id;
end;
$$;

revoke all on function public.turnitin_admin_grant_credits(uuid, integer, timestamptz, text, uuid)
  from public, anon, authenticated;
grant execute on function public.turnitin_admin_grant_credits(uuid, integer, timestamptz, text, uuid)
  to service_role;

comment on table public.turnitin_admin_credit_grants is
  'Immutable audit record for prepaid Turnitin credits manually granted by Admin. The actual spendable balance remains in turnitin_credit_batches.';
comment on function public.turnitin_admin_grant_credits(uuid, integer, timestamptz, text, uuid) is
  'Atomically creates an Admin Turnitin credit batch, grant audit row and immutable ledger entry. Service-role only.';

commit;
