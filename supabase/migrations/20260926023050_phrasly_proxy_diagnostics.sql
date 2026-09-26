-- Phase 3 live diagnostics: safe upstream outcome markers only.
-- No cookies, tokens, response bodies, or other upstream secrets are stored.

alter table public.phrasly_proxy_sessions
  add column if not exists last_error_code text null,
  add column if not exists last_upstream_status integer null,
  add column if not exists diagnostic_updated_at timestamptz null;

comment on column public.phrasly_proxy_sessions.last_error_code is
  'Safe Phrasly proxy diagnostic code. Never stores cookie/token values or response bodies.';
comment on column public.phrasly_proxy_sessions.last_upstream_status is
  'Last upstream HTTP status observed by the Phrasly proxy.';
comment on column public.phrasly_proxy_sessions.diagnostic_updated_at is
  'Timestamp of the latest Phrasly proxy diagnostic update.';
