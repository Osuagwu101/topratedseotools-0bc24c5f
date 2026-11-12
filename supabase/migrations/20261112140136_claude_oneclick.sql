-- Add Claude without changing any existing tool session or customer balance.
alter table public.tool_authorized_sessions drop constraint if exists tool_authorized_sessions_supported_tools;
alter table public.tool_authorized_sessions add constraint tool_authorized_sessions_supported_tools
  check (tool_slug = any (array['stealthwriter'::text, 'phrasly'::text, 'chatgpt'::text, 'grammarly'::text, 'claude'::text]));

-- Claude one-click proxy.
-- Writers receive a short-lived handoff ticket, then only a Topratedseotools
-- HttpOnly proxy cookie; the shared Claude login stays in the encrypted
-- tool_authorized_sessions vault.

create table if not exists public.claude_proxy_sessions (
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

create index if not exists claude_proxy_sessions_user_idx
  on public.claude_proxy_sessions (user_id, created_at desc);

alter table public.claude_proxy_sessions enable row level security;
revoke all on table public.claude_proxy_sessions from anon;
revoke all on table public.claude_proxy_sessions from authenticated;
grant all on table public.claude_proxy_sessions to service_role;

-- Per-writer conversations on the shared Claude account.
create table if not exists public.claude_conversation_owners (
  conversation_id uuid primary key,
  organization_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists claude_conversation_owners_user_idx
  on public.claude_conversation_owners (user_id, created_at desc);

alter table public.claude_conversation_owners enable row level security;
revoke all on table public.claude_conversation_owners from anon;
revoke all on table public.claude_conversation_owners from authenticated;
grant all on table public.claude_conversation_owners to service_role;

-- Tool settings row; one-click stays off until the proxy is verified live.
insert into public.tool_settings (tool_slug, enabled, one_click_auth_enabled, launch_mode)
values ('claude', false, false, 'new_tab')
on conflict (tool_slug) do nothing;
