-- Phase 5.1: StealthWriter AWS parity controls.
-- Mirrors the recovered AWS behavior for:
--   * separate Humanizer / AI Detector entitlements and daily limits
--   * WAT (Africa/Lagos) daily buckets
--   * per-browser device enforcement
--   * proxy-session device binding
-- Raw StealthWriter auth cookies remain in tool_authorized_sessions only.

create table if not exists public.stealthwriter_user_controls (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'active'
    check (status in ('active', 'suspended')),
  device_limit integer not null default 2
    check (device_limit between 1 and 10),
  humanizer_enabled boolean not null default true,
  humanizer_daily_limit integer not null default 20
    check (humanizer_daily_limit between 0 and 10000),
  ai_detector_enabled boolean not null default true,
  ai_detector_daily_limit integer not null default 20
    check (ai_detector_daily_limit between 0 and 10000),
  suspended_reason text null,
  suspended_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stealthwriter_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_fingerprint text not null,
  label text not null default 'Device',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (user_id, device_fingerprint)
);

create index if not exists stealthwriter_devices_user_last_seen_idx
  on public.stealthwriter_devices (user_id, last_seen_at desc);

create table if not exists public.stealthwriter_daily_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  feature_key text not null
    check (feature_key in ('humanizer', 'ai_detector')),
  usage_day date not null,
  count integer not null default 0 check (count >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, feature_key, usage_day)
);

create index if not exists stealthwriter_daily_usage_day_idx
  on public.stealthwriter_daily_usage (usage_day, feature_key);

alter table public.stealthwriter_proxy_sessions
  add column if not exists device_fingerprint text null;

-- Existing proxy sessions pre-date device binding. Expire them so every
-- post-migration session starts through the new device gate.
update public.stealthwriter_proxy_sessions
set status = 'expired'
where status in ('issued', 'active')
  and device_fingerprint is null;

-- Existing StealthWriter customers get the same two-feature / 20-per-day
-- baseline the AWS source advertised. Admin can narrow either feature later.
insert into public.stealthwriter_user_controls (user_id)
select distinct user_id
from public.tool_orders
where tool_slug = 'stealthwriter'
on conflict (user_id) do nothing;

insert into public.stealthwriter_user_controls (user_id)
select distinct user_id
from public.tool_access_grants
where tool_slug = 'stealthwriter'
on conflict (user_id) do nothing;

alter table public.stealthwriter_user_controls enable row level security;
alter table public.stealthwriter_devices enable row level security;
alter table public.stealthwriter_daily_usage enable row level security;

revoke all on table public.stealthwriter_user_controls from anon, authenticated;
revoke all on table public.stealthwriter_devices from anon, authenticated;
revoke all on table public.stealthwriter_daily_usage from anon, authenticated;
grant all on table public.stealthwriter_user_controls to service_role;
grant all on table public.stealthwriter_devices to service_role;
grant all on table public.stealthwriter_daily_usage to service_role;

create or replace function public.consume_stealthwriter_usage(
  _user_id uuid,
  _feature_key text,
  _free_rehumanize boolean default false
)
returns table (
  allowed boolean,
  used integer,
  daily_limit integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer;
  v_enabled boolean;
  v_status text;
  v_day date;
  v_used integer;
begin
  if _feature_key not in ('humanizer', 'ai_detector') then
    return query select false, 0, 0;
    return;
  end if;

  select
    status,
    case
      when _feature_key = 'humanizer' then humanizer_enabled
      else ai_detector_enabled
    end,
    case
      when _feature_key = 'humanizer' then humanizer_daily_limit
      else ai_detector_daily_limit
    end
  into v_status, v_enabled, v_limit
  from public.stealthwriter_user_controls
  where user_id = _user_id;

  if v_status is distinct from 'active' or coalesce(v_enabled, false) = false then
    return query select false, 0, coalesce(v_limit, 0);
    return;
  end if;

  v_day := (timezone('Africa/Lagos', now()))::date;

  insert into public.stealthwriter_daily_usage(user_id, feature_key, usage_day, count)
  values (_user_id, _feature_key, v_day, 0)
  on conflict (user_id, feature_key, usage_day) do nothing;

  if _free_rehumanize and _feature_key = 'humanizer' then
    select count into v_used
    from public.stealthwriter_daily_usage
    where user_id = _user_id
      and feature_key = _feature_key
      and usage_day = v_day;

    return query select true, coalesce(v_used, 0), v_limit;
    return;
  end if;

  update public.stealthwriter_daily_usage
  set count = count + 1,
      updated_at = now()
  where user_id = _user_id
    and feature_key = _feature_key
    and usage_day = v_day
    and count < v_limit
  returning count into v_used;

  if not found then
    select count into v_used
    from public.stealthwriter_daily_usage
    where user_id = _user_id
      and feature_key = _feature_key
      and usage_day = v_day;

    return query select false, coalesce(v_used, 0), v_limit;
    return;
  end if;

  return query select true, v_used, v_limit;
end;
$$;

revoke all on function public.consume_stealthwriter_usage(uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.consume_stealthwriter_usage(uuid, text, boolean)
  to service_role;

comment on table public.stealthwriter_user_controls is
  'AWS-parity StealthWriter feature entitlements, daily limits and device policy.';
comment on table public.stealthwriter_devices is
  'Persistent per-browser StealthWriter device registrations for One-Click access.';
comment on table public.stealthwriter_daily_usage is
  'Per-user, per-feature StealthWriter daily usage bucketed at Africa/Lagos midnight.';
