-- Phase 2: allow the shared server-only authorised-session vault to store
-- one encrypted ChatGPT admin session in addition to StealthWriter and Phrasly.
-- No writer launch path is enabled by this migration.

alter table public.tool_authorized_sessions
  drop constraint if exists tool_authorized_sessions_supported_tools;

alter table public.tool_authorized_sessions
  add constraint tool_authorized_sessions_supported_tools
  check (tool_slug in ('stealthwriter', 'phrasly', 'chatgpt'));

comment on table public.tool_authorized_sessions is
  'Server-only encrypted authorised session state for supported tools; never exposed to anon/authenticated clients.';

comment on column public.tool_authorized_sessions.encrypted_payload is
  'AES-GCM encrypted opaque upstream session state; never exposed to anon/authenticated clients.';
