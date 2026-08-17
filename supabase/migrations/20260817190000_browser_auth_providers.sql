-- Browser-based one-click authentication configuration and audit trail.
-- API tokens remain in internal_secrets; these tables contain no secret values.

create table if not exists public.browser_auth_settings (
  id boolean primary key default true check (id = true),
  enabled boolean not null default false,
  default_provider text not null default 'browser_use'
    check (default_provider in ('browser_use', 'cloudflare')),
  session_timeout_minutes integer not null default 30
    check (session_timeout_minutes between 5 and 60),
  updated_by uuid null,
  updated_at timestamptz not null default now()
);

insert into public.browser_auth_settings (id)
values (true)
on conflict (id) do nothing;

alter table public.browser_auth_settings enable row level security;
revoke all on table public.browser_auth_settings from anon, authenticated;

create table if not exists public.browser_auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid null references public.tool_orders(id) on delete set null,
  tool_slug text not null,
  provider text not null check (provider in ('browser_use', 'cloudflare')),
  provider_session_id text null,
  status text not null default 'starting'
    check (status in ('starting', 'ready', 'failed', 'expired', 'closed')),
  error_code text null,
  created_at timestamptz not null default now(),
  expires_at timestamptz null,
  updated_at timestamptz not null default now()
);

create index if not exists browser_auth_sessions_user_recent_idx
  on public.browser_auth_sessions (user_id, created_at desc);
create index if not exists browser_auth_sessions_order_idx
  on public.browser_auth_sessions (order_id, created_at desc);

alter table public.browser_auth_sessions enable row level security;
revoke all on table public.browser_auth_sessions from anon, authenticated;

-- Constrain per-tool provider overrides to the supported browser engines.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tool_settings_auth_provider_supported'
      and conrelid = 'public.tool_settings'::regclass
  ) then
    alter table public.tool_settings
      add constraint tool_settings_auth_provider_supported
      check (auth_provider is null or auth_provider in ('browser_use', 'cloudflare'));
  end if;
end $$;
