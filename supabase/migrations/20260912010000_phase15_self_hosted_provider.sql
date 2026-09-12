-- Phase 15: allow explicit per-tool Self Hosted runtime selection.
-- Browser Use remains the global default; clearing a tool override rolls back.

alter table public.browser_auth_sessions drop constraint if exists browser_auth_sessions_provider_check;
alter table public.browser_auth_sessions add constraint browser_auth_sessions_provider_check
  check (provider in ('browser_use', 'cloudflare', 'self_hosted'));

alter table public.tool_settings drop constraint if exists tool_settings_auth_provider_supported;
alter table public.tool_settings add constraint tool_settings_auth_provider_supported
  check (auth_provider is null or auth_provider in ('browser_use', 'cloudflare', 'self_hosted'));
