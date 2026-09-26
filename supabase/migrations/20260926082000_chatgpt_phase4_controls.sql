-- Phase 4: ChatGPT AWS-parity access controls and device hardening.
-- ChatGPT controls are isolated from StealthWriter/Phrasly and never suspend
-- unrelated Topratedseotools tools.

create table if not exists public.chatgpt_user_controls (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active','suspended')),
  device_limit integer not null default 2 check (device_limit between 1 and 10),
  suspended_reason text null,
  suspended_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chatgpt_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_fingerprint text not null,
  label text not null default 'Device',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique(user_id, device_fingerprint)
);

create index if not exists chatgpt_devices_user_idx
  on public.chatgpt_devices (user_id, last_seen_at desc);

alter table public.chatgpt_proxy_sessions
  add column if not exists device_fingerprint text null;

create index if not exists chatgpt_proxy_sessions_device_idx
  on public.chatgpt_proxy_sessions (user_id, device_fingerprint);

alter table public.chatgpt_user_controls enable row level security;
alter table public.chatgpt_devices enable row level security;

revoke all on table public.chatgpt_user_controls from anon;
revoke all on table public.chatgpt_user_controls from authenticated;
grant all on table public.chatgpt_user_controls to service_role;

revoke all on table public.chatgpt_devices from anon;
revoke all on table public.chatgpt_devices from authenticated;
grant all on table public.chatgpt_devices to service_role;

comment on table public.chatgpt_user_controls is
  'Server-only per-user ChatGPT access status and device limits.';
comment on table public.chatgpt_devices is
  'Server-only stable ChatGPT device registrations.';
comment on column public.chatgpt_proxy_sessions.device_fingerprint is
  'Stable browser device identity bound to an active ChatGPT proxy session.';
