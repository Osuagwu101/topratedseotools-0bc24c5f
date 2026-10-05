-- Turnitin V2 Phase 4: Postpaid account engine.
-- Adds an isolated billing mode and per-job postpaid charges without changing
-- ordinary subscriptions, tool_orders, tool_payments or prepaid credit balances.

begin;

-- ---------------------------------------------------------------------------
-- Account billing mode. Missing/legacy customers remain prepaid.
-- ---------------------------------------------------------------------------
create table if not exists public.turnitin_account_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  billing_mode text not null default 'prepaid'
    check (billing_mode in ('prepaid','postpaid')),
  postpaid_rate_ngn integer null
    check (postpaid_rate_ngn is null or postpaid_rate_ngn > 0),
  postpaid_enabled_at timestamptz null,
  postpaid_enabled_by uuid null references auth.users(id) on delete set null,
  postpaid_disabled_at timestamptz null,
  postpaid_disabled_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint turnitin_account_settings_postpaid_rate_chk check (
    (billing_mode = 'prepaid')
    or
    (billing_mode = 'postpaid' and postpaid_rate_ngn is not null and postpaid_rate_ngn > 0)
  )
);

drop trigger if exists trg_turnitin_account_settings_updated
  on public.turnitin_account_settings;
create trigger trg_turnitin_account_settings_updated
  before update on public.turnitin_account_settings
  for each row execute function public.tg_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Immutable account-mode audit events.
-- ---------------------------------------------------------------------------
create table if not exists public.turnitin_postpaid_account_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null
    check (event_type in ('postpaid_enabled','postpaid_disabled','rate_changed')),
  previous_mode text null
    check (previous_mode is null or previous_mode in ('prepaid','postpaid')),
  new_mode text null
    check (new_mode is null or new_mode in ('prepaid','postpaid')),
  previous_rate_ngn integer null
    check (previous_rate_ngn is null or previous_rate_ngn > 0),
  new_rate_ngn integer null
    check (new_rate_ngn is null or new_rate_ngn > 0),
  reason text not null check (char_length(btrim(reason)) between 3 and 1000),
  actor_admin_id uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists turnitin_postpaid_account_events_user_idx
  on public.turnitin_postpaid_account_events (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Immutable negotiated-rate history. A rate change never rewrites old charges.
-- ---------------------------------------------------------------------------
create table if not exists public.turnitin_postpaid_rate_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  previous_rate_ngn integer null
    check (previous_rate_ngn is null or previous_rate_ngn > 0),
  new_rate_ngn integer not null check (new_rate_ngn > 0),
  effective_at timestamptz not null default now(),
  changed_by uuid null references auth.users(id) on delete set null,
  reason text not null check (char_length(btrim(reason)) between 3 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists turnitin_postpaid_rate_history_user_idx
  on public.turnitin_postpaid_rate_history (user_id, effective_at desc);

-- ---------------------------------------------------------------------------
-- Freeze the billing mode chosen when each job is created. Existing jobs remain
-- prepaid. Postpaid rate itself is intentionally snapshotted only when the job
-- becomes billable (Originality acceptance), not at upload intent.
-- ---------------------------------------------------------------------------
alter table public.turnitin_jobs
  add column if not exists billing_mode text not null default 'prepaid'
    check (billing_mode in ('prepaid','postpaid'));

create index if not exists turnitin_jobs_billing_mode_idx
  on public.turnitin_jobs (user_id, billing_mode, status, created_at desc);

-- ---------------------------------------------------------------------------
-- One financial charge per accepted Postpaid job. rate_ngn is the immutable
-- agreed rate at acceptance; amount_ngn is therefore never recomputed later.
-- Phase 5 will add settlement/allocation records against these charges.
-- ---------------------------------------------------------------------------
create table if not exists public.turnitin_postpaid_charges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.turnitin_jobs(id) on delete restrict,
  upstream_submission_id text not null,
  rate_ngn integer not null check (rate_ngn > 0),
  amount_ngn integer not null check (amount_ngn > 0),
  paid_amount_ngn integer not null default 0
    check (paid_amount_ngn >= 0 and paid_amount_ngn <= amount_ngn),
  status text not null default 'unpaid'
    check (status in ('unpaid','partially_paid','paid','void')),
  charged_at timestamptz not null default now(),
  voided_at timestamptz null,
  void_reason text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint turnitin_postpaid_charges_job_uid unique (job_id),
  constraint turnitin_postpaid_charges_void_chk check (
    (status <> 'void')
    or
    (voided_at is not null and paid_amount_ngn = 0)
  )
);

create unique index if not exists turnitin_postpaid_charges_upstream_uidx
  on public.turnitin_postpaid_charges (upstream_submission_id);

create index if not exists turnitin_postpaid_charges_user_status_idx
  on public.turnitin_postpaid_charges (user_id, status, charged_at desc);

drop trigger if exists trg_turnitin_postpaid_charges_updated
  on public.turnitin_postpaid_charges;
create trigger trg_turnitin_postpaid_charges_updated
  before update on public.turnitin_postpaid_charges
  for each row execute function public.tg_touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS/read boundaries.
-- ---------------------------------------------------------------------------
alter table public.turnitin_account_settings enable row level security;
alter table public.turnitin_postpaid_account_events enable row level security;
alter table public.turnitin_postpaid_rate_history enable row level security;
alter table public.turnitin_postpaid_charges enable row level security;

revoke all on table public.turnitin_account_settings from anon, authenticated;
revoke all on table public.turnitin_postpaid_account_events from anon, authenticated;
revoke all on table public.turnitin_postpaid_rate_history from anon, authenticated;
revoke all on table public.turnitin_postpaid_charges from anon, authenticated;

grant select on table public.turnitin_account_settings to authenticated;
grant select on table public.turnitin_postpaid_charges to authenticated;
grant select on table public.turnitin_postpaid_account_events to authenticated;
grant select on table public.turnitin_postpaid_rate_history to authenticated;

grant all on table public.turnitin_account_settings to service_role;
grant all on table public.turnitin_postpaid_account_events to service_role;
grant all on table public.turnitin_postpaid_rate_history to service_role;
grant all on table public.turnitin_postpaid_charges to service_role;

drop policy if exists "turnitin account owner read"
  on public.turnitin_account_settings;
create policy "turnitin account owner read"
  on public.turnitin_account_settings for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

drop policy if exists "turnitin postpaid charges owner read"
  on public.turnitin_postpaid_charges;
create policy "turnitin postpaid charges owner read"
  on public.turnitin_postpaid_charges for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

drop policy if exists "turnitin postpaid events admin read"
  on public.turnitin_postpaid_account_events;
create policy "turnitin postpaid events admin read"
  on public.turnitin_postpaid_account_events for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

drop policy if exists "turnitin postpaid rates admin read"
  on public.turnitin_postpaid_rate_history;
create policy "turnitin postpaid rates admin read"
  on public.turnitin_postpaid_rate_history for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------------------
-- Super Admin-only enable/disable. Disabling is blocked while Postpaid jobs are
-- active or money remains outstanding. Existing prepaid credits are untouched.
-- ---------------------------------------------------------------------------
create or replace function public.turnitin_set_postpaid_status(
  _user_id uuid,
  _enabled boolean,
  _rate_ngn integer,
  _reason text,
  _admin_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  _current public.turnitin_account_settings%rowtype;
  _clean_reason text := btrim(coalesce(_reason, ''));
  _now timestamptz := now();
begin
  if _user_id is null or not exists (
    select 1 from public.profiles p where p.id = _user_id
  ) then
    raise exception 'TURNITIN_POSTPAID_CUSTOMER_NOT_FOUND';
  end if;

  if _admin_id is null or not exists (
    select 1
    from public.user_roles r
    where r.user_id = _admin_id
      and r.role = 'admin'
      and coalesce(r.is_active, true)
      and coalesce(r.is_super_admin, false)
  ) then
    raise exception 'TURNITIN_POSTPAID_SUPER_ADMIN_REQUIRED';
  end if;

  if char_length(_clean_reason) < 3 or char_length(_clean_reason) > 1000 then
    raise exception 'TURNITIN_POSTPAID_REASON_INVALID';
  end if;

  select *
  into _current
  from public.turnitin_account_settings
  where user_id = _user_id
  for update;

  if not found then
    insert into public.turnitin_account_settings (user_id, billing_mode)
    values (_user_id, 'prepaid')
    returning * into _current;
  end if;

  if _enabled then
    if _rate_ngn is null or _rate_ngn <= 0 or _rate_ngn > 10000000 then
      raise exception 'TURNITIN_POSTPAID_RATE_INVALID';
    end if;

    if _current.billing_mode = 'postpaid' then
      if _current.postpaid_rate_ngn = _rate_ngn then
        return 'postpaid';
      end if;
      raise exception 'TURNITIN_POSTPAID_ALREADY_ENABLED_USE_RATE_UPDATE';
    end if;

    update public.turnitin_account_settings
    set billing_mode = 'postpaid',
        postpaid_rate_ngn = _rate_ngn,
        postpaid_enabled_at = _now,
        postpaid_enabled_by = _admin_id,
        postpaid_disabled_at = null,
        postpaid_disabled_by = null
    where user_id = _user_id;

    insert into public.turnitin_postpaid_rate_history (
      user_id, previous_rate_ngn, new_rate_ngn,
      effective_at, changed_by, reason
    )
    values (
      _user_id, _current.postpaid_rate_ngn, _rate_ngn,
      _now, _admin_id, _clean_reason
    );

    insert into public.turnitin_postpaid_account_events (
      user_id, event_type, previous_mode, new_mode,
      previous_rate_ngn, new_rate_ngn, reason, actor_admin_id
    )
    values (
      _user_id, 'postpaid_enabled', _current.billing_mode, 'postpaid',
      _current.postpaid_rate_ngn, _rate_ngn, _clean_reason, _admin_id
    );

    return 'postpaid';
  end if;

  if _current.billing_mode <> 'postpaid' then
    return 'prepaid';
  end if;

  if exists (
    select 1
    from public.turnitin_postpaid_charges c
    where c.user_id = _user_id
      and c.status in ('unpaid','partially_paid')
      and c.amount_ngn > c.paid_amount_ngn
  ) then
    raise exception 'TURNITIN_POSTPAID_OUTSTANDING_BALANCE';
  end if;

  if exists (
    select 1
    from public.turnitin_jobs j
    where j.user_id = _user_id
      and j.billing_mode = 'postpaid'
      and j.status in ('draft','uploading','queued','processing')
  ) then
    raise exception 'TURNITIN_POSTPAID_ACTIVE_JOBS';
  end if;

  update public.turnitin_account_settings
  set billing_mode = 'prepaid',
      postpaid_rate_ngn = null,
      postpaid_disabled_at = _now,
      postpaid_disabled_by = _admin_id
  where user_id = _user_id;

  insert into public.turnitin_postpaid_account_events (
    user_id, event_type, previous_mode, new_mode,
    previous_rate_ngn, new_rate_ngn, reason, actor_admin_id
  )
  values (
    _user_id, 'postpaid_disabled', 'postpaid', 'prepaid',
    _current.postpaid_rate_ngn, null, _clean_reason, _admin_id
  );

  return 'prepaid';
end;
$$;

-- ---------------------------------------------------------------------------
-- Active Admin/Super Admin may update an agreed Postpaid rate. Old job charges
-- retain their original snapshotted rate.
-- ---------------------------------------------------------------------------
create or replace function public.turnitin_update_postpaid_rate(
  _user_id uuid,
  _new_rate_ngn integer,
  _reason text,
  _admin_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  _current public.turnitin_account_settings%rowtype;
  _clean_reason text := btrim(coalesce(_reason, ''));
  _now timestamptz := now();
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

  if _new_rate_ngn is null or _new_rate_ngn <= 0 or _new_rate_ngn > 10000000 then
    raise exception 'TURNITIN_POSTPAID_RATE_INVALID';
  end if;

  if char_length(_clean_reason) < 3 or char_length(_clean_reason) > 1000 then
    raise exception 'TURNITIN_POSTPAID_REASON_INVALID';
  end if;

  select *
  into _current
  from public.turnitin_account_settings
  where user_id = _user_id
  for update;

  if not found or _current.billing_mode <> 'postpaid' then
    raise exception 'TURNITIN_POSTPAID_NOT_ENABLED';
  end if;

  if _current.postpaid_rate_ngn = _new_rate_ngn then
    return _new_rate_ngn;
  end if;

  update public.turnitin_account_settings
  set postpaid_rate_ngn = _new_rate_ngn
  where user_id = _user_id;

  insert into public.turnitin_postpaid_rate_history (
    user_id, previous_rate_ngn, new_rate_ngn,
    effective_at, changed_by, reason
  )
  values (
    _user_id, _current.postpaid_rate_ngn, _new_rate_ngn,
    _now, _admin_id, _clean_reason
  );

  insert into public.turnitin_postpaid_account_events (
    user_id, event_type, previous_mode, new_mode,
    previous_rate_ngn, new_rate_ngn, reason, actor_admin_id
  )
  values (
    _user_id, 'rate_changed', 'postpaid', 'postpaid',
    _current.postpaid_rate_ngn, _new_rate_ngn, _clean_reason, _admin_id
  );

  return _new_rate_ngn;
end;
$$;

-- ---------------------------------------------------------------------------
-- Acceptance finaliser for Postpaid jobs. The current agreed rate is read and
-- snapshotted atomically at the moment the accepted submission is charged.
-- ---------------------------------------------------------------------------
create or replace function public.turnitin_charge_postpaid_job(
  _user_id uuid,
  _job_id uuid,
  _upstream_submission_id text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _job public.turnitin_jobs%rowtype;
  _settings public.turnitin_account_settings%rowtype;
  _charge_id uuid;
begin
  if _upstream_submission_id is null or btrim(_upstream_submission_id) = '' then
    raise exception 'TURNITIN_POSTPAID_UPSTREAM_ID_REQUIRED';
  end if;

  select *
  into _job
  from public.turnitin_jobs
  where id = _job_id
    and user_id = _user_id
  for update;

  if not found then
    raise exception 'TURNITIN_POSTPAID_JOB_NOT_FOUND';
  end if;

  if _job.billing_mode <> 'postpaid' then
    raise exception 'TURNITIN_POSTPAID_JOB_MODE_INVALID';
  end if;

  if _job.upstream_submission_id is distinct from _upstream_submission_id then
    raise exception 'TURNITIN_POSTPAID_UPSTREAM_ID_CONFLICT';
  end if;

  select id
  into _charge_id
  from public.turnitin_postpaid_charges
  where job_id = _job_id;

  if _charge_id is not null then
    return _charge_id;
  end if;

  select *
  into _settings
  from public.turnitin_account_settings
  where user_id = _user_id
  for update;

  if not found
     or _settings.billing_mode <> 'postpaid'
     or _settings.postpaid_rate_ngn is null
     or _settings.postpaid_rate_ngn <= 0 then
    raise exception 'TURNITIN_POSTPAID_ACCOUNT_NOT_BILLABLE';
  end if;

  insert into public.turnitin_postpaid_charges (
    user_id,
    job_id,
    upstream_submission_id,
    rate_ngn,
    amount_ngn,
    paid_amount_ngn,
    status,
    charged_at
  )
  values (
    _user_id,
    _job_id,
    _upstream_submission_id,
    _settings.postpaid_rate_ngn,
    _settings.postpaid_rate_ngn,
    0,
    'unpaid',
    coalesce(_job.accepted_at, now())
  )
  returning id into _charge_id;

  return _charge_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- A fully failed accepted Postpaid job voids its unpaid charge instead of
-- granting a replacement credit.
-- ---------------------------------------------------------------------------
create or replace function public.turnitin_void_postpaid_charge(
  _user_id uuid,
  _job_id uuid,
  _reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  _charge public.turnitin_postpaid_charges%rowtype;
  _clean_reason text := btrim(coalesce(_reason, 'Originality Reports marked the accepted job as failed.'));
begin
  select *
  into _charge
  from public.turnitin_postpaid_charges
  where user_id = _user_id
    and job_id = _job_id
  for update;

  if not found then
    return false;
  end if;

  if _charge.status = 'void' then
    return true;
  end if;

  if _charge.paid_amount_ngn > 0 or _charge.status in ('partially_paid','paid') then
    raise exception 'TURNITIN_POSTPAID_PAID_CHARGE_CANNOT_VOID';
  end if;

  update public.turnitin_postpaid_charges
  set status = 'void',
      voided_at = now(),
      void_reason = left(_clean_reason, 1000)
  where id = _charge.id;

  return true;
end;
$$;

-- All mutations remain server/service-role only.
revoke all on function public.turnitin_set_postpaid_status(uuid, boolean, integer, text, uuid)
  from public, anon, authenticated;
revoke all on function public.turnitin_update_postpaid_rate(uuid, integer, text, uuid)
  from public, anon, authenticated;
revoke all on function public.turnitin_charge_postpaid_job(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.turnitin_void_postpaid_charge(uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function public.turnitin_set_postpaid_status(uuid, boolean, integer, text, uuid)
  to service_role;
grant execute on function public.turnitin_update_postpaid_rate(uuid, integer, text, uuid)
  to service_role;
grant execute on function public.turnitin_charge_postpaid_job(uuid, uuid, text)
  to service_role;
grant execute on function public.turnitin_void_postpaid_charge(uuid, uuid, text)
  to service_role;

comment on table public.turnitin_account_settings is
  'Turnitin billing mode. Missing rows and prepaid rows use the prepaid credit engine; Postpaid rows require an agreed rate.';
comment on table public.turnitin_postpaid_rate_history is
  'Immutable negotiated Postpaid rate history. Historical job charges never recalculate from this table.';
comment on table public.turnitin_postpaid_charges is
  'One immutable-rate financial charge per accepted Postpaid Turnitin job. Settlements are added in Phase 5.';
comment on function public.turnitin_charge_postpaid_job(uuid, uuid, text) is
  'Snapshots the current agreed Postpaid rate when Originality Reports accepts a Postpaid job.';

commit;
