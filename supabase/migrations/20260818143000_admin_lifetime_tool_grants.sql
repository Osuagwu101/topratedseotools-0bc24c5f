-- Non-payment admin grants for complimentary/lifetime tool access.
-- These are intentionally separate from payment/order records.

create table if not exists public.tool_access_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tool_slug text not null,
  access_type text not null default 'shared' check (access_type in ('shared','private')),
  account_id uuid not null references public.tool_accounts(id) on delete restrict,
  status text not null default 'active' check (status in ('active','revoked')),
  expires_at timestamptz null,
  granted_at timestamptz not null default now(),
  granted_by uuid null references auth.users(id) on delete set null,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tool_access_grants enable row level security;

create unique index if not exists tool_access_grants_one_active_per_user_tool
  on public.tool_access_grants(user_id, tool_slug)
  where status = 'active';

create index if not exists tool_access_grants_account_active_idx
  on public.tool_access_grants(account_id)
  where status = 'active';

alter table public.tool_account_assignments
  add column if not exists grant_id uuid null references public.tool_access_grants(id) on delete cascade;

create unique index if not exists tool_account_assignments_one_active_per_grant
  on public.tool_account_assignments(grant_id)
  where status = 'active' and grant_id is not null;

alter table public.browser_auth_sessions
  add column if not exists grant_id uuid null references public.tool_access_grants(id) on delete set null;
