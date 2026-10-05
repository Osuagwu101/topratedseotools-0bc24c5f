-- Turnitin V2 Phase 5: Postpaid settlements and allocations.
-- Adds auditable partial/full settlement history without deleting or rewriting charges.

begin;

create table if not exists public.turnitin_postpaid_settlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount_ngn integer not null check (amount_ngn > 0),
  allocated_amount_ngn integer not null default 0
    check (allocated_amount_ngn >= 0 and allocated_amount_ngn <= amount_ngn),
  method text not null
    check (method in ('website','bank_transfer','whatsapp','offline','other')),
  status text not null default 'pending'
    check (status in ('pending','confirmed','failed','void')),
  payment_gateway text null,
  payment_reference text null,
  gateway_environment text null,
  gateway_reference text null,
  gateway_transaction_id text null,
  recorded_by uuid null references auth.users(id) on delete set null,
  note text null,
  initiated_at timestamptz not null default now(),
  confirmed_at timestamptz null,
  failed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint turnitin_postpaid_settlement_confirmed_chk check (
    (status <> 'confirmed') or confirmed_at is not null
  ),
  constraint turnitin_postpaid_settlement_failed_chk check (
    (status <> 'failed') or failed_at is not null
  )
);

create index if not exists turnitin_postpaid_settlements_user_idx
  on public.turnitin_postpaid_settlements (user_id, created_at desc);

create unique index if not exists turnitin_postpaid_settlements_reference_uidx
  on public.turnitin_postpaid_settlements (payment_gateway, payment_reference)
  where payment_reference is not null;

create unique index if not exists turnitin_postpaid_one_pending_website_uidx
  on public.turnitin_postpaid_settlements (user_id)
  where method = 'website' and status = 'pending';

drop trigger if exists trg_turnitin_postpaid_settlements_updated
  on public.turnitin_postpaid_settlements;
create trigger trg_turnitin_postpaid_settlements_updated
  before update on public.turnitin_postpaid_settlements
  for each row execute function public.tg_touch_updated_at();

create table if not exists public.turnitin_postpaid_allocations (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null
    references public.turnitin_postpaid_settlements(id) on delete restrict,
  charge_id uuid not null
    references public.turnitin_postpaid_charges(id) on delete restrict,
  amount_ngn integer not null check (amount_ngn > 0),
  allocated_at timestamptz not null default now(),
  constraint turnitin_postpaid_allocations_pair_uid unique (settlement_id, charge_id)
);

create index if not exists turnitin_postpaid_allocations_charge_idx
  on public.turnitin_postpaid_allocations (charge_id, allocated_at);

alter table public.turnitin_postpaid_settlements enable row level security;
alter table public.turnitin_postpaid_allocations enable row level security;

revoke all on table public.turnitin_postpaid_settlements from anon, authenticated;
revoke all on table public.turnitin_postpaid_allocations from anon, authenticated;
grant select on table public.turnitin_postpaid_settlements to authenticated;
grant select on table public.turnitin_postpaid_allocations to authenticated;
grant all on table public.turnitin_postpaid_settlements to service_role;
grant all on table public.turnitin_postpaid_allocations to service_role;

drop policy if exists "turnitin settlements owner read"
  on public.turnitin_postpaid_settlements;
create policy "turnitin settlements owner read"
  on public.turnitin_postpaid_settlements
  for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

drop policy if exists "turnitin allocations owner read"
  on public.turnitin_postpaid_allocations;
create policy "turnitin allocations owner read"
  on public.turnitin_postpaid_allocations
  for select to authenticated
  using (
    exists (
      select 1
      from public.turnitin_postpaid_settlements s
      where s.id = settlement_id
        and (s.user_id = auth.uid() or public.has_role(auth.uid(), 'admin'))
    )
  );

create or replace function public.turnitin_apply_postpaid_settlement(
  _settlement_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  _settlement public.turnitin_postpaid_settlements%rowtype;
  _charge public.turnitin_postpaid_charges%rowtype;
  _already_allocated integer := 0;
  _remaining integer := 0;
  _charge_remaining integer := 0;
  _allocation integer := 0;
begin
  select *
  into _settlement
  from public.turnitin_postpaid_settlements
  where id = _settlement_id
  for update;

  if not found then
    raise exception 'TURNITIN_POSTPAID_SETTLEMENT_NOT_FOUND';
  end if;

  if _settlement.status <> 'confirmed' then
    raise exception 'TURNITIN_POSTPAID_SETTLEMENT_NOT_CONFIRMED';
  end if;

  select coalesce(sum(a.amount_ngn), 0)::integer
  into _already_allocated
  from public.turnitin_postpaid_allocations a
  where a.settlement_id = _settlement_id;

  _remaining := greatest(0, _settlement.amount_ngn - _already_allocated);

  if _remaining = 0 then
    update public.turnitin_postpaid_settlements
    set allocated_amount_ngn = _already_allocated
    where id = _settlement_id;
    return _already_allocated;
  end if;

  for _charge in
    select c.*
    from public.turnitin_postpaid_charges c
    where c.user_id = _settlement.user_id
      and c.status in ('unpaid','partially_paid')
      and c.amount_ngn > c.paid_amount_ngn
    order by c.charged_at asc, c.created_at asc, c.id asc
    for update
  loop
    exit when _remaining <= 0;

    _charge_remaining := greatest(0, _charge.amount_ngn - _charge.paid_amount_ngn);
    if _charge_remaining = 0 then
      continue;
    end if;

    _allocation := least(_remaining, _charge_remaining);

    insert into public.turnitin_postpaid_allocations (
      settlement_id,
      charge_id,
      amount_ngn
    )
    values (
      _settlement_id,
      _charge.id,
      _allocation
    )
    on conflict (settlement_id, charge_id)
    do update set
      amount_ngn = public.turnitin_postpaid_allocations.amount_ngn + excluded.amount_ngn;

    update public.turnitin_postpaid_charges
    set paid_amount_ngn = paid_amount_ngn + _allocation,
        status = case
          when paid_amount_ngn + _allocation >= amount_ngn then 'paid'
          else 'partially_paid'
        end
    where id = _charge.id;

    _already_allocated := _already_allocated + _allocation;
    _remaining := _remaining - _allocation;
  end loop;

  update public.turnitin_postpaid_settlements
  set allocated_amount_ngn = _already_allocated
  where id = _settlement_id;

  return _already_allocated;
end;
$$;

create or replace function public.turnitin_record_manual_postpaid_settlement(
  _user_id uuid,
  _amount_ngn integer,
  _method text,
  _note text,
  _admin_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _settlement_id uuid := gen_random_uuid();
  _outstanding integer := 0;
  _clean_note text := btrim(coalesce(_note, ''));
begin
  if _admin_id is null or not exists (
    select 1
    from public.user_roles r
    where r.user_id = _admin_id
      and r.role = 'admin'
      and coalesce(r.is_active, true)
  ) then
    raise exception 'TURNITIN_POSTPAID_ADMIN_REQUIRED';
  end if;

  if _user_id is null or not exists (
    select 1 from public.profiles p where p.id = _user_id
  ) then
    raise exception 'TURNITIN_POSTPAID_CUSTOMER_NOT_FOUND';
  end if;

  if _amount_ngn is null or _amount_ngn <= 0 then
    raise exception 'TURNITIN_POSTPAID_SETTLEMENT_AMOUNT_INVALID';
  end if;

  if _method not in ('bank_transfer','whatsapp','offline','other') then
    raise exception 'TURNITIN_POSTPAID_MANUAL_METHOD_INVALID';
  end if;

  if char_length(_clean_note) < 3 or char_length(_clean_note) > 1000 then
    raise exception 'TURNITIN_POSTPAID_SETTLEMENT_NOTE_INVALID';
  end if;

  if exists (
    select 1
    from public.turnitin_postpaid_settlements s
    where s.user_id = _user_id
      and s.method = 'website'
      and s.status = 'pending'
  ) then
    raise exception 'TURNITIN_POSTPAID_ONLINE_SETTLEMENT_PENDING';
  end if;

  select coalesce(sum(greatest(0, c.amount_ngn - c.paid_amount_ngn)), 0)::integer
  into _outstanding
  from public.turnitin_postpaid_charges c
  where c.user_id = _user_id
    and c.status in ('unpaid','partially_paid');

  if _outstanding <= 0 then
    raise exception 'TURNITIN_POSTPAID_NOTHING_OUTSTANDING';
  end if;

  if _amount_ngn > _outstanding then
    raise exception 'TURNITIN_POSTPAID_SETTLEMENT_EXCEEDS_OUTSTANDING';
  end if;

  insert into public.turnitin_postpaid_settlements (
    id,
    user_id,
    amount_ngn,
    allocated_amount_ngn,
    method,
    status,
    recorded_by,
    note,
    initiated_at,
    confirmed_at
  )
  values (
    _settlement_id,
    _user_id,
    _amount_ngn,
    0,
    _method,
    'confirmed',
    _admin_id,
    _clean_note,
    now(),
    now()
  );

  perform public.turnitin_apply_postpaid_settlement(_settlement_id);

  return _settlement_id;
end;
$$;

create or replace function public.turnitin_finalize_postpaid_settlement(
  _settlement_id uuid,
  _reference text,
  _gateway_transaction_id text,
  _paid_at timestamptz
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  _settlement public.turnitin_postpaid_settlements%rowtype;
  _allocated integer;
begin
  select *
  into _settlement
  from public.turnitin_postpaid_settlements
  where id = _settlement_id
  for update;

  if not found then
    raise exception 'TURNITIN_POSTPAID_SETTLEMENT_NOT_FOUND';
  end if;

  if _settlement.method <> 'website' then
    raise exception 'TURNITIN_POSTPAID_SETTLEMENT_METHOD_INVALID';
  end if;

  if _settlement.payment_reference is distinct from _reference then
    raise exception 'TURNITIN_POSTPAID_SETTLEMENT_REFERENCE_MISMATCH';
  end if;

  if _settlement.status = 'confirmed' then
    return _settlement.allocated_amount_ngn;
  end if;

  if _settlement.status <> 'pending' then
    raise exception 'TURNITIN_POSTPAID_SETTLEMENT_NOT_PENDING';
  end if;

  update public.turnitin_postpaid_settlements
  set status = 'confirmed',
      gateway_transaction_id = coalesce(_gateway_transaction_id, gateway_transaction_id),
      confirmed_at = coalesce(_paid_at, now()),
      failed_at = null
  where id = _settlement_id;

  _allocated := public.turnitin_apply_postpaid_settlement(_settlement_id);
  return _allocated;
end;
$$;

revoke all on function public.turnitin_apply_postpaid_settlement(uuid)
  from public, anon, authenticated;
revoke all on function public.turnitin_record_manual_postpaid_settlement(uuid, integer, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.turnitin_finalize_postpaid_settlement(uuid, text, text, timestamptz)
  from public, anon, authenticated;

grant execute on function public.turnitin_apply_postpaid_settlement(uuid)
  to service_role;
grant execute on function public.turnitin_record_manual_postpaid_settlement(uuid, integer, text, text, uuid)
  to service_role;
grant execute on function public.turnitin_finalize_postpaid_settlement(uuid, text, text, timestamptz)
  to service_role;

comment on table public.turnitin_postpaid_settlements is
  'Permanent Postpaid money-received ledger. Manual and website settlements remain auditable after allocation.';
comment on table public.turnitin_postpaid_allocations is
  'Immutable allocation trail from Postpaid settlements to individual accepted-check charges.';
comment on function public.turnitin_apply_postpaid_settlement(uuid) is
  'Allocates confirmed settlement money to oldest outstanding Postpaid checks first.';

commit;
