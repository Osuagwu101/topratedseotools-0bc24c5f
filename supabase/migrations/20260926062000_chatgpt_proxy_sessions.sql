-- Phase 3: ChatGPT one-click proxy launch sessions.
-- The handoff URL is short-lived. After exchange, writers receive only a
-- Topratedseotools HttpOnly proxy cookie; upstream ChatGPT auth stays in the
-- encrypted tool_authorized_sessions vault.
-- Safe diagnostics store only outcome/status metadata, never response bodies or secrets.

create table if not exists public.chatgpt_proxy_sessions (
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
  expires_at timestamptz not null,
  last_error_code text null,
  last_upstream_status integer null,
  diagnostic_updated_at timestamptz null
);

create index if not exists chatgpt_proxy_sessions_user_idx
  on public.chatgpt_proxy_sessions (user_id, created_at desc);

create index if not exists chatgpt_proxy_sessions_expiry_idx
  on public.chatgpt_proxy_sessions (status, expires_at);

alter table public.chatgpt_proxy_sessions enable row level security;

revoke all on table public.chatgpt_proxy_sessions from anon;
revoke all on table public.chatgpt_proxy_sessions from authenticated;
grant all on table public.chatgpt_proxy_sessions to service_role;

comment on table public.chatgpt_proxy_sessions is
  'Server-only ChatGPT proxy sessions for authorised internal writers.';
comment on column public.chatgpt_proxy_sessions.last_error_code is
  'Safe ChatGPT proxy diagnostic code. Never stores cookie/token values or response bodies.';
comment on column public.chatgpt_proxy_sessions.last_upstream_status is
  'Last upstream HTTP status observed by the ChatGPT proxy.';
comment on column public.chatgpt_proxy_sessions.diagnostic_updated_at is
  'Timestamp of the latest ChatGPT proxy diagnostic update.';
