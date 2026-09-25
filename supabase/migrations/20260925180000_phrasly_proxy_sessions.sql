-- Phase 3: Phrasly one-click proxy launch sessions.
-- The handoff URL is short-lived. After exchange, writers receive only a
-- Topratedseotools HttpOnly proxy cookie; upstream Phrasly auth stays in the
-- encrypted tool_authorized_sessions vault.

create table if not exists public.phrasly_proxy_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_kind text not null check (source_kind in ('order', 'grant')),
  source_id text not null,
  status text not null default 'issued'
    check (status in ('issued', 'active', 'expired', 'revoked')),
  created_at timestamptz not null default now(),
  activated_at timestamptz null,
  last_seen_at timestamptz null,
  expires_at timestamptz not null
);

create index if not exists phrasly_proxy_sessions_user_idx
  on public.phrasly_proxy_sessions (user_id, created_at desc);

create index if not exists phrasly_proxy_sessions_expiry_idx
  on public.phrasly_proxy_sessions (status, expires_at);

alter table public.phrasly_proxy_sessions enable row level security;

revoke all on table public.phrasly_proxy_sessions from anon;
revoke all on table public.phrasly_proxy_sessions from authenticated;
grant all on table public.phrasly_proxy_sessions to service_role;

comment on table public.phrasly_proxy_sessions is
  'Server-only Phrasly proxy sessions for authorised internal writers.';
