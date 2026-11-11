-- Allow the shared Grammarly login in the encrypted authorised-session vault.
alter table public.tool_authorized_sessions
  drop constraint if exists tool_authorized_sessions_supported_tools;
alter table public.tool_authorized_sessions
  add constraint tool_authorized_sessions_supported_tools
  check (tool_slug = any (array['stealthwriter'::text, 'phrasly'::text, 'chatgpt'::text, 'grammarly'::text]));
