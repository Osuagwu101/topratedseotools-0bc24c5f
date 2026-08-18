-- One-time server-to-server SSO tickets for owned tools.
-- These are intentionally separate from payment records and browser sessions.
create table if not exists public.direct_sso_tickets (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  tool_slug text not null,
  account_id uuid null references public.tool_accounts(id) on delete set null,
  target_email text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists direct_sso_tickets_user_tool_idx
  on public.direct_sso_tickets (user_id, tool_slug, created_at desc);

create index if not exists direct_sso_tickets_expiry_idx
  on public.direct_sso_tickets (expires_at)
  where consumed_at is null;

alter table public.direct_sso_tickets enable row level security;

comment on table public.direct_sso_tickets is
  'Short-lived, single-use SSO tickets issued server-side for owned tools. No client policies; service role only.';
