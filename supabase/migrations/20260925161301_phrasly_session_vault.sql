-- Phase 2: allow the shared server-only authorised-session vault to store
-- one encrypted Phrasly session in addition to StealthWriter.
-- Existing StealthWriter rows and encryption are unchanged.

alter table public.tool_authorized_sessions
  drop constraint if exists tool_authorized_sessions_stealthwriter_only;

alter table public.tool_authorized_sessions
  drop constraint if exists tool_authorized_sessions_supported_tools;

alter table public.tool_authorized_sessions
  add constraint tool_authorized_sessions_supported_tools
  check (tool_slug in ('stealthwriter', 'phrasly'));

comment on table public.tool_authorized_sessions is
  'Server-only encrypted authorised session state for supported proxied tools.';

comment on column public.tool_authorized_sessions.encrypted_payload is
  'AES-GCM encrypted opaque upstream session state; never exposed to anon/authenticated clients.';
