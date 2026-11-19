-- Additive: per-account Claude session JSON vault, matching StealthWriter.
-- Account 1 keeps the existing legacy vault (tool_authorized_sessions, tool_slug
-- 'claude') as its source of truth; these columns hold Account 2's own
-- encrypted bundle and per-account metadata for both slots.
begin;
alter table public.claude_provider_accounts
  add column if not exists session_status text not null default 'not_configured',
  add column if not exists encrypted_payload text null,
  add column if not exists session_format text null,
  add column if not exists session_updated_at timestamptz null,
  add column if not exists session_updated_by uuid null references auth.users(id) on delete set null,
  add column if not exists rotated_at timestamptz null;

alter table public.claude_provider_accounts
  drop constraint if exists claude_provider_accounts_session_status_check;
alter table public.claude_provider_accounts
  add constraint claude_provider_accounts_session_status_check
  check (session_status in ('not_configured', 'stored', 'revoked'));

alter table public.claude_provider_accounts
  drop constraint if exists claude_provider_accounts_session_payload_check;
alter table public.claude_provider_accounts
  add constraint claude_provider_accounts_session_payload_check
  check (session_status <> 'stored' or encrypted_payload is not null);
commit;
