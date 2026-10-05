-- Turnitin Phase 3: isolated credit, job and report foundation.
-- This migration deliberately does not alter tool_orders, tool_payments,
-- StealthWriter, Phrasly, ChatGPT, admin authentication, or existing checkout flows.

begin;

-- ---------------------------------------------------------------------------
-- Credit purchases
-- A purchase becomes spendable only after server-side code marks it paid and
-- calls turnitin_grant_paid_purchase(). Payment wiring is a later phase.
-- ---------------------------------------------------------------------------
create table if not exists public.turnitin_credit_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  quantity integer not null check (quantity > 0),
  unit_amount_ngn integer not null default 2300 check (unit_amount_ngn > 0),
  total_amount_ngn integer generated always as (quantity * unit_amount_ngn) stored,
  status text not null default 'pending'
    check (status in ('pending','paid','failed','cancelled','refunded')),
  payment_gateway text null,
  payment_reference text null,
  paid_at timestamptz null,
  expires_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint turnitin_credit_purchases_paid_at_chk
    check (status <> 'paid' or paid_at is not null)
);

create unique index if not exists turnitin_credit_purchases_payment_ref_uidx
  on public.turnitin_credit_purchases (payment_gateway, payment_reference)
  where payment_reference is not null;

create index if not exists turnitin_credit_purchases_user_idx
  on public.turnitin_credit_purchases (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Jobs
-- reserved_credit_batch_id is wired to turnitin_credit_batches after that
-- table is created, avoiding a circular create-order dependency.
-- ---------------------------------------------------------------------------
create table if not exists public.turnitin_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  original_filename text not null,
  display_name text null,
  mime_type text null,
  file_size_bytes bigint null check (file_size_bytes is null or file_size_bytes >= 0),
  source_storage_bucket text null,
  source_storage_path text null,

  status text not null default 'draft'
    check (status in ('draft','uploading','queued','processing','completed','failed')),
  upstream_status text null,
  upstream_submission_id text null,

  exclude_bibliography boolean not null default false,
  exclude_quotes boolean not null default false,
  exclude_citations boolean not null default false,
  exclude_small_matches boolean not null default false,
  small_match_mode text not null default 'words'
    check (small_match_mode in ('words','percent')),
  small_match_threshold integer null
    check (small_match_threshold is null or small_match_threshold >= 0),
  report_view text not null default 'match_groups'
    check (report_view in ('sources','match_groups')),
  report_format text null,

  report_title text null,
  author_first_name text null,
  author_last_name text null,

  word_count integer null check (word_count is null or word_count >= 0),
  similarity_percentage numeric(5,2) null
    check (similarity_percentage is null or similarity_percentage between 0 and 100),
  ai_percentage numeric(5,2) null
    check (ai_percentage is null or ai_percentage between 0 and 100),
  ai_unavailable_reason text null,

  credit_state text not null default 'none'
    check (credit_state in ('none','reserved','consumed','refunded')),
  reserved_credit_batch_id uuid null,
  reservation_version integer not null default 0 check (reservation_version >= 0),
  reserved_at timestamptz null,
  consumed_at timestamptz null,
  refunded_at timestamptz null,

  submitted_at timestamptz null,
  accepted_at timestamptz null,
  completed_at timestamptz null,
  failed_at timestamptz null,
  failure_code text null,
  failure_message text null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists turnitin_jobs_upstream_submission_uidx
  on public.turnitin_jobs (upstream_submission_id)
  where upstream_submission_id is not null;

create index if not exists turnitin_jobs_user_created_idx
  on public.turnitin_jobs (user_id, created_at desc);

create index if not exists turnitin_jobs_user_status_idx
  on public.turnitin_jobs (user_id, status, created_at desc);

create index if not exists turnitin_jobs_user_filename_idx
  on public.turnitin_jobs (user_id, lower(original_filename));

-- ---------------------------------------------------------------------------
-- Credit batches
-- Credits are tracked by batch so each paid batch can expire exactly seven
-- days after its own payment time. Reserved credits remain attached to a job.
-- ---------------------------------------------------------------------------
create table if not exists public.turnitin_credit_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null default 'purchase'
    check (source in ('purchase','refund','admin')),
  purchase_id uuid null references public.turnitin_credit_purchases(id) on delete restrict,
  source_job_id uuid null references public.turnitin_jobs(id) on delete set null,

  granted_credits integer not null check (granted_credits > 0),
  available_credits integer not null check (available_credits >= 0),
  reserved_credits integer not null default 0 check (reserved_credits >= 0),
  consumed_credits integer not null default 0 check (consumed_credits >= 0),
  expired_credits integer not null default 0 check (expired_credits >= 0),
  refunded_credits integer not null default 0 check (refunded_credits >= 0),

  expires_at timestamptz not null,
  note text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint turnitin_credit_batches_accounting_chk check (
    granted_credits =
      available_credits +
      reserved_credits +
      consumed_credits +
      expired_credits +
      refunded_credits
  ),
  constraint turnitin_credit_batches_source_chk check (
    (source = 'purchase' and purchase_id is not null and source_job_id is null)
    or
    (source = 'refund' and purchase_id is null and source_job_id is not null)
    or
    (source = 'admin' and purchase_id is null)
  )
);

create unique index if not exists turnitin_credit_batches_purchase_uidx
  on public.turnitin_credit_batches (purchase_id)
  where purchase_id is not null;

create unique index if not exists turnitin_credit_batches_refund_job_uidx
  on public.turnitin_credit_batches (source_job_id)
  where source = 'refund' and source_job_id is not null;

create index if not exists turnitin_credit_batches_spend_idx
  on public.turnitin_credit_batches (user_id, expires_at, created_at)
  where available_credits > 0;

alter table public.turnitin_jobs
  drop constraint if exists turnitin_jobs_reserved_credit_batch_fk;

alter table public.turnitin_jobs
  add constraint turnitin_jobs_reserved_credit_batch_fk
  foreign key (reserved_credit_batch_id)
  references public.turnitin_credit_batches(id)
  on delete set null;

-- ---------------------------------------------------------------------------
-- Immutable credit ledger
-- All balance-changing functions write a ledger row in the same transaction.
-- ---------------------------------------------------------------------------
create table if not exists public.turnitin_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  batch_id uuid null references public.turnitin_credit_batches(id) on delete set null,
  purchase_id uuid null references public.turnitin_credit_purchases(id) on delete set null,
  job_id uuid null references public.turnitin_jobs(id) on delete set null,

  event_type text not null
    check (event_type in (
      'grant','reserve','consume','release','refund','refund_grant','expire','adjustment'
    )),

  available_delta integer not null default 0,
  reserved_delta integer not null default 0,
  consumed_delta integer not null default 0,
  expired_delta integer not null default 0,
  refunded_delta integer not null default 0,

  idempotency_key text null,
  note text null,
  created_at timestamptz not null default now(),

  constraint turnitin_credit_ledger_nonzero_chk check (
    available_delta <> 0
    or reserved_delta <> 0
    or consumed_delta <> 0
    or expired_delta <> 0
    or refunded_delta <> 0
  )
);

create unique index if not exists turnitin_credit_ledger_idempotency_uidx
  on public.turnitin_credit_ledger (idempotency_key)
  where idempotency_key is not null;

create index if not exists turnitin_credit_ledger_user_idx
  on public.turnitin_credit_ledger (user_id, created_at desc);

create index if not exists turnitin_credit_ledger_job_idx
  on public.turnitin_credit_ledger (job_id, created_at);

-- ---------------------------------------------------------------------------
-- Report metadata
-- PDFs remain private. Later phases will expose downloads through server routes,
-- not public storage URLs.
-- ---------------------------------------------------------------------------
create table if not exists public.turnitin_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.turnitin_jobs(id) on delete cascade,
  report_type text not null check (report_type in ('similarity','ai')),
  status text not null default 'pending'
    check (status in ('pending','available','unavailable','failed')),
  score numeric(5,2) null check (score is null or score between 0 and 100),
  storage_bucket text null,
  storage_path text null,
  mime_type text null,
  file_size_bytes bigint null check (file_size_bytes is null or file_size_bytes >= 0),
  sha256 text null,
  unavailable_reason text null,
  available_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(job_id, report_type)
);

create index if not exists turnitin_reports_user_idx
  on public.turnitin_reports (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
drop trigger if exists trg_turnitin_credit_purchases_updated on public.turnitin_credit_purchases;
create trigger trg_turnitin_credit_purchases_updated
  before update on public.turnitin_credit_purchases
  for each row execute function public.tg_touch_updated_at();

drop trigger if exists trg_turnitin_jobs_updated on public.turnitin_jobs;
create trigger trg_turnitin_jobs_updated
  before update on public.turnitin_jobs
  for each row execute function public.tg_touch_updated_at();

drop trigger if exists trg_turnitin_credit_batches_updated on public.turnitin_credit_batches;
create trigger trg_turnitin_credit_batches_updated
  before update on public.turnitin_credit_batches
  for each row execute function public.tg_touch_updated_at();

drop trigger if exists trg_turnitin_reports_updated on public.turnitin_reports;
create trigger trg_turnitin_reports_updated
  before update on public.turnitin_reports
  for each row execute function public.tg_touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: customers/admins may read; all mutations remain server-only.
-- ---------------------------------------------------------------------------
alter table public.turnitin_credit_purchases enable row level security;
alter table public.turnitin_credit_batches enable row level security;
alter table public.turnitin_credit_ledger enable row level security;
alter table public.turnitin_jobs enable row level security;
alter table public.turnitin_reports enable row level security;

revoke all on table public.turnitin_credit_purchases from anon, authenticated;
revoke all on table public.turnitin_credit_batches from anon, authenticated;
revoke all on table public.turnitin_credit_ledger from anon, authenticated;
revoke all on table public.turnitin_jobs from anon, authenticated;
revoke all on table public.turnitin_reports from anon, authenticated;

grant select on table public.turnitin_credit_purchases to authenticated;
grant select on table public.turnitin_credit_batches to authenticated;
grant select on table public.turnitin_credit_ledger to authenticated;
grant select on table public.turnitin_jobs to authenticated;
grant select on table public.turnitin_reports to authenticated;

grant all on table public.turnitin_credit_purchases to service_role;
grant all on table public.turnitin_credit_batches to service_role;
grant all on table public.turnitin_credit_ledger to service_role;
grant all on table public.turnitin_jobs to service_role;
grant all on table public.turnitin_reports to service_role;

drop policy if exists "turnitin purchases owner read" on public.turnitin_credit_purchases;
create policy "turnitin purchases owner read"
  on public.turnitin_credit_purchases for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

drop policy if exists "turnitin batches owner read" on public.turnitin_credit_batches;
create policy "turnitin batches owner read"
  on public.turnitin_credit_batches for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

drop policy if exists "turnitin ledger owner read" on public.turnitin_credit_ledger;
create policy "turnitin ledger owner read"
  on public.turnitin_credit_ledger for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

drop policy if exists "turnitin jobs owner read" on public.turnitin_jobs;
create policy "turnitin jobs owner read"
  on public.turnitin_jobs for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

drop policy if exists "turnitin reports owner read" on public.turnitin_reports;
create policy "turnitin reports owner read"
  on public.turnitin_reports for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------------------
-- Atomic credit functions. These are service-role only.
-- ---------------------------------------------------------------------------

create or replace function public.turnitin_expire_user_credits(_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  _batch record;
  _amount integer;
  _total integer := 0;
begin
  for _batch in
    select id, available_credits
    from public.turnitin_credit_batches
    where user_id = _user_id
      and available_credits > 0
      and expires_at <= now()
    order by expires_at, created_at
    for update
  loop
    _amount := _batch.available_credits;

    update public.turnitin_credit_batches
    set available_credits = 0,
        expired_credits = expired_credits + _amount
    where id = _batch.id;

    insert into public.turnitin_credit_ledger (
      user_id, batch_id, event_type,
      available_delta, expired_delta,
      idempotency_key, note
    )
    values (
      _user_id, _batch.id, 'expire',
      -_amount, _amount,
      'expire:' || _batch.id::text,
      'Unused Turnitin credits expired after the batch validity window.'
    )
    on conflict (idempotency_key) where idempotency_key is not null do nothing;

    _total := _total + _amount;
  end loop;

  return _total;
end;
$$;

create or replace function public.turnitin_grant_paid_purchase(_purchase_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _purchase public.turnitin_credit_purchases%rowtype;
  _batch_id uuid;
  _expiry timestamptz;
begin
  select *
  into _purchase
  from public.turnitin_credit_purchases
  where id = _purchase_id
  for update;

  if not found then
    raise exception 'TURNITIN_PURCHASE_NOT_FOUND';
  end if;

  select id
  into _batch_id
  from public.turnitin_credit_batches
  where purchase_id = _purchase_id;

  if _batch_id is not null then
    return _batch_id;
  end if;

  if _purchase.status <> 'paid' or _purchase.paid_at is null then
    raise exception 'TURNITIN_PURCHASE_NOT_PAID';
  end if;

  _expiry := coalesce(_purchase.expires_at, _purchase.paid_at + interval '7 days');

  insert into public.turnitin_credit_batches (
    user_id, source, purchase_id,
    granted_credits, available_credits,
    expires_at, note
  )
  values (
    _purchase.user_id, 'purchase', _purchase.id,
    _purchase.quantity, _purchase.quantity,
    _expiry, 'Credits granted from a paid Turnitin credit purchase.'
  )
  returning id into _batch_id;

  update public.turnitin_credit_purchases
  set expires_at = _expiry
  where id = _purchase.id
    and expires_at is null;

  insert into public.turnitin_credit_ledger (
    user_id, batch_id, purchase_id, event_type,
    available_delta, idempotency_key, note
  )
  values (
    _purchase.user_id, _batch_id, _purchase.id, 'grant',
    _purchase.quantity,
    'grant-purchase:' || _purchase.id::text,
    'Paid Turnitin credits granted.'
  )
  on conflict (idempotency_key) where idempotency_key is not null do nothing;

  perform public.turnitin_expire_user_credits(_purchase.user_id);

  return _batch_id;
end;
$$;

create or replace function public.turnitin_reserve_credit(
  _user_id uuid,
  _job_id uuid
)
returns table(batch_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  _job public.turnitin_jobs%rowtype;
  _batch_id uuid;
  _expires_at timestamptz;
  _version integer;
begin
  select *
  into _job
  from public.turnitin_jobs
  where id = _job_id
    and user_id = _user_id
  for update;

  if not found then
    raise exception 'TURNITIN_JOB_NOT_FOUND';
  end if;

  if _job.credit_state in ('reserved','consumed') then
    return query
      select b.id, b.expires_at
      from public.turnitin_credit_batches b
      where b.id = _job.reserved_credit_batch_id;
    return;
  end if;

  if _job.credit_state = 'refunded' then
    raise exception 'TURNITIN_JOB_ALREADY_REFUNDED';
  end if;

  if _job.status = 'completed' then
    raise exception 'TURNITIN_JOB_ALREADY_COMPLETED';
  end if;

  perform public.turnitin_expire_user_credits(_user_id);

  select b.id, b.expires_at
  into _batch_id, _expires_at
  from public.turnitin_credit_batches b
  where b.user_id = _user_id
    and b.available_credits > 0
    and b.expires_at > now()
  order by b.expires_at, b.created_at
  limit 1
  for update skip locked;

  if _batch_id is null then
    raise exception 'TURNITIN_NO_CREDIT';
  end if;

  update public.turnitin_credit_batches
  set available_credits = available_credits - 1,
      reserved_credits = reserved_credits + 1
  where id = _batch_id
    and available_credits > 0;

  if not found then
    raise exception 'TURNITIN_CREDIT_RESERVATION_RACE';
  end if;

  _version := _job.reservation_version + 1;

  update public.turnitin_jobs
  set credit_state = 'reserved',
      reserved_credit_batch_id = _batch_id,
      reservation_version = _version,
      reserved_at = now(),
      refunded_at = null
  where id = _job_id;

  insert into public.turnitin_credit_ledger (
    user_id, batch_id, job_id, event_type,
    available_delta, reserved_delta,
    idempotency_key, note
  )
  values (
    _user_id, _batch_id, _job_id, 'reserve',
    -1, 1,
    'reserve:' || _job_id::text || ':' || _version::text,
    'One credit reserved before upstream submission.'
  );

  batch_id := _batch_id;
  expires_at := _expires_at;
  return next;
end;
$$;

create or replace function public.turnitin_consume_reserved_credit(
  _user_id uuid,
  _job_id uuid,
  _upstream_submission_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  _job public.turnitin_jobs%rowtype;
begin
  if _upstream_submission_id is null or btrim(_upstream_submission_id) = '' then
    raise exception 'TURNITIN_UPSTREAM_ID_REQUIRED';
  end if;

  select *
  into _job
  from public.turnitin_jobs
  where id = _job_id
    and user_id = _user_id
  for update;

  if not found then
    raise exception 'TURNITIN_JOB_NOT_FOUND';
  end if;

  if _job.credit_state = 'consumed' then
    if _job.upstream_submission_id is distinct from _upstream_submission_id then
      raise exception 'TURNITIN_UPSTREAM_ID_CONFLICT';
    end if;
    return true;
  end if;

  if _job.credit_state <> 'reserved' or _job.reserved_credit_batch_id is null then
    raise exception 'TURNITIN_CREDIT_NOT_RESERVED';
  end if;

  update public.turnitin_credit_batches
  set reserved_credits = reserved_credits - 1,
      consumed_credits = consumed_credits + 1
  where id = _job.reserved_credit_batch_id
    and user_id = _user_id
    and reserved_credits > 0;

  if not found then
    raise exception 'TURNITIN_RESERVED_CREDIT_MISSING';
  end if;

  update public.turnitin_jobs
  set credit_state = 'consumed',
      consumed_at = now(),
      upstream_submission_id = _upstream_submission_id,
      upstream_status = 'queued',
      status = 'queued',
      accepted_at = coalesce(accepted_at, now()),
      submitted_at = coalesce(submitted_at, now())
  where id = _job_id;

  insert into public.turnitin_credit_ledger (
    user_id, batch_id, job_id, event_type,
    reserved_delta, consumed_delta,
    idempotency_key, note
  )
  values (
    _user_id, _job.reserved_credit_batch_id, _job_id, 'consume',
    -1, 1,
    'consume:' || _job_id::text || ':' || _job.reservation_version::text,
    'Reserved credit consumed after Originality Reports accepted the job.'
  )
  on conflict (idempotency_key) where idempotency_key is not null do nothing;

  return true;
end;
$$;

create or replace function public.turnitin_release_reserved_credit(
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
  _job public.turnitin_jobs%rowtype;
  _batch public.turnitin_credit_batches%rowtype;
  _available_delta integer := 0;
  _expired_delta integer := 0;
begin
  select *
  into _job
  from public.turnitin_jobs
  where id = _job_id
    and user_id = _user_id
  for update;

  if not found then
    raise exception 'TURNITIN_JOB_NOT_FOUND';
  end if;

  if _job.credit_state <> 'reserved' then
    return false;
  end if;

  select *
  into _batch
  from public.turnitin_credit_batches
  where id = _job.reserved_credit_batch_id
    and user_id = _user_id
  for update;

  if not found or _batch.reserved_credits <= 0 then
    raise exception 'TURNITIN_RESERVED_CREDIT_MISSING';
  end if;

  if _batch.expires_at > now() then
    update public.turnitin_credit_batches
    set reserved_credits = reserved_credits - 1,
        available_credits = available_credits + 1
    where id = _batch.id;
    _available_delta := 1;
  else
    update public.turnitin_credit_batches
    set reserved_credits = reserved_credits - 1,
        expired_credits = expired_credits + 1
    where id = _batch.id;
    _expired_delta := 1;
  end if;

  update public.turnitin_jobs
  set credit_state = 'none',
      reserved_credit_batch_id = null,
      reserved_at = null
  where id = _job_id;

  insert into public.turnitin_credit_ledger (
    user_id, batch_id, job_id, event_type,
    available_delta, reserved_delta, expired_delta,
    idempotency_key, note
  )
  values (
    _user_id, _batch.id, _job_id, 'release',
    _available_delta, -1, _expired_delta,
    'release:' || _job_id::text || ':' || _job.reservation_version::text,
    coalesce(_reason, 'Reserved credit released before upstream acceptance.')
  )
  on conflict (idempotency_key) where idempotency_key is not null do nothing;

  return true;
end;
$$;

create or replace function public.turnitin_refund_consumed_credit(
  _user_id uuid,
  _job_id uuid,
  _reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _job public.turnitin_jobs%rowtype;
  _refund_batch_id uuid;
begin
  select *
  into _job
  from public.turnitin_jobs
  where id = _job_id
    and user_id = _user_id
  for update;

  if not found then
    raise exception 'TURNITIN_JOB_NOT_FOUND';
  end if;

  if _job.credit_state = 'refunded' then
    select id
    into _refund_batch_id
    from public.turnitin_credit_batches
    where source = 'refund'
      and source_job_id = _job_id;
    return _refund_batch_id;
  end if;

  if _job.credit_state <> 'consumed' or _job.reserved_credit_batch_id is null then
    raise exception 'TURNITIN_CREDIT_NOT_CONSUMED';
  end if;

  update public.turnitin_credit_batches
  set consumed_credits = consumed_credits - 1,
      refunded_credits = refunded_credits + 1
  where id = _job.reserved_credit_batch_id
    and user_id = _user_id
    and consumed_credits > 0;

  if not found then
    raise exception 'TURNITIN_CONSUMED_CREDIT_MISSING';
  end if;

  insert into public.turnitin_credit_batches (
    user_id, source, source_job_id,
    granted_credits, available_credits,
    expires_at, note
  )
  values (
    _user_id, 'refund', _job_id,
    1, 1,
    now() + interval '7 days',
    coalesce(_reason, 'Replacement credit after a completely failed accepted job.')
  )
  returning id into _refund_batch_id;

  insert into public.turnitin_credit_ledger (
    user_id, batch_id, job_id, event_type,
    consumed_delta, refunded_delta,
    idempotency_key, note
  )
  values (
    _user_id, _job.reserved_credit_batch_id, _job_id, 'refund',
    -1, 1,
    'refund:' || _job_id::text,
    coalesce(_reason, 'Consumed credit refunded because the accepted job completely failed.')
  )
  on conflict (idempotency_key) where idempotency_key is not null do nothing;

  insert into public.turnitin_credit_ledger (
    user_id, batch_id, job_id, event_type,
    available_delta,
    idempotency_key, note
  )
  values (
    _user_id, _refund_batch_id, _job_id, 'refund_grant',
    1,
    'refund-grant:' || _job_id::text,
    'Fresh replacement credit valid for seven days.'
  )
  on conflict (idempotency_key) where idempotency_key is not null do nothing;

  update public.turnitin_jobs
  set credit_state = 'refunded',
      refunded_at = now()
  where id = _job_id;

  return _refund_batch_id;
end;
$$;

-- Read-only helper for the logged-in customer dashboard.
create or replace function public.turnitin_my_credit_summary()
returns table(
  available_credits bigint,
  reserved_credits bigint,
  next_expiry_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    coalesce(sum(b.available_credits) filter (where b.expires_at > now()), 0)::bigint,
    coalesce(sum(b.reserved_credits), 0)::bigint,
    min(b.expires_at) filter (
      where b.available_credits > 0
        and b.expires_at > now()
    )
  from public.turnitin_credit_batches b
  where b.user_id = auth.uid();
$$;

-- Mutation functions are intentionally server-only.
revoke all on function public.turnitin_expire_user_credits(uuid) from public, anon, authenticated;
revoke all on function public.turnitin_grant_paid_purchase(uuid) from public, anon, authenticated;
revoke all on function public.turnitin_reserve_credit(uuid, uuid) from public, anon, authenticated;
revoke all on function public.turnitin_consume_reserved_credit(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.turnitin_release_reserved_credit(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.turnitin_refund_consumed_credit(uuid, uuid, text) from public, anon, authenticated;

grant execute on function public.turnitin_expire_user_credits(uuid) to service_role;
grant execute on function public.turnitin_grant_paid_purchase(uuid) to service_role;
grant execute on function public.turnitin_reserve_credit(uuid, uuid) to service_role;
grant execute on function public.turnitin_consume_reserved_credit(uuid, uuid, text) to service_role;
grant execute on function public.turnitin_release_reserved_credit(uuid, uuid, text) to service_role;
grant execute on function public.turnitin_refund_consumed_credit(uuid, uuid, text) to service_role;

revoke all on function public.turnitin_my_credit_summary() from public, anon;
grant execute on function public.turnitin_my_credit_summary() to authenticated, service_role;

comment on table public.turnitin_credit_purchases is
  'Turnitin-only prepaid credit purchase records. Not part of the normal tool subscription order model.';
comment on table public.turnitin_credit_batches is
  'Per-purchase/refund Turnitin credit batches with independent seven-day expiry.';
comment on table public.turnitin_credit_ledger is
  'Immutable audit trail for all Turnitin credit state changes.';
comment on table public.turnitin_jobs is
  'TopRatedSEOTools Turnitin check jobs and Originality Reports submission state.';
comment on table public.turnitin_reports is
  'Private metadata for similarity and AI PDF reports associated with Turnitin jobs.';

commit;
