-- Phase 15: add Self Hosted without changing the Browser Use default.
alter table public.browser_auth_settings
  drop constraint if exists browser_auth_settings_default_provider_check;
alter table public.browser_auth_settings
  add constraint browser_auth_settings_default_provider_check
  check (default_provider in ('browser_use', 'cloudflare', 'self_hosted'));

alter table public.browser_auth_sessions
  drop constraint if exists browser_auth_sessions_provider_check;
alter table public.browser_auth_sessions
  add constraint browser_auth_sessions_provider_check
  check (provider in ('browser_use', 'cloudflare', 'self_hosted'));

alter table public.tool_account_sessions
  drop constraint if exists tool_account_sessions_provider_check;
alter table public.tool_account_sessions
  add constraint tool_account_sessions_provider_check
  check (provider in ('browser_use', 'cloudflare', 'self_hosted'));

alter table public.tool_settings
  drop constraint if exists tool_settings_auth_provider_supported;
alter table public.tool_settings
  add constraint tool_settings_auth_provider_supported
  check (auth_provider is null or auth_provider in ('browser_use', 'cloudflare', 'self_hosted'));
