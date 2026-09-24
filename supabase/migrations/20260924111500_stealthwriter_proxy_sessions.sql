-- Phase 3: StealthWriter one-click proxy launch sessions.
-- The handoff URL is short-lived (60 seconds); after exchange the proxy
-- session is long-lived. Upstream StealthWriter cookies remain separately
-- encrypted in tool_authorized_sessions and are never copied to these rows.

create table if not exists public.stealthwriter_proxy_sessions (
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

create index if not exists stealthwriter_proxy_sessions_user_idx
  on public.stealthwriter_proxy_sessions (user_id, created_at desc);

create index if not exists stealthwriter_proxy_sessions_expiry_idx
  on public.stealthwriter_proxy_sessions (status, expires_at);

alter table public.stealthwriter_proxy_sessions enable row level security;

revoke all on table public.stealthwriter_proxy_sessions from anon;
revoke all on table public.stealthwriter_proxy_sessions from authenticated;
grant all on table public.stealthwriter_proxy_sessions to service_role;

alter table public.tool_authorized_sessions
  add column if not exists rotated_at timestamptz null;

comment on table public.stealthwriter_proxy_sessions is
  'Server-only StealthWriter proxy sessions: 60-second handoff, then long-lived access session.';
