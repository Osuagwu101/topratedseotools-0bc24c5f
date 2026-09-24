-- Phase 2: StealthWriter authorised-session vault.
-- Raw session values are encrypted in the application before they reach this table.
-- No anon/authenticated client role is allowed to read or write the encrypted payload.

create table if not exists public.tool_authorized_sessions (
  tool_slug text primary key,
  encrypted_payload text not null,
  session_format text not null default 'better_auth_cookie_json',
  status text not null default 'stored'
    check (status in ('stored', 'revoked')),
  updated_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tool_authorized_sessions_stealthwriter_only
    check (tool_slug = 'stealthwriter')
);

alter table public.tool_authorized_sessions enable row level security;

revoke all on table public.tool_authorized_sessions from anon;
revoke all on table public.tool_authorized_sessions from authenticated;
grant all on table public.tool_authorized_sessions to service_role;

comment on table public.tool_authorized_sessions is
  'Server-only encrypted authorised browser session state for StealthWriter.';
