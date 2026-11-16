-- StealthWriter server-only vault, launch/session and device model, isolated to QuillBot.
begin;
create table if not exists public.quillbot_provider_accounts (
 account_key text primary key check (account_key ~ '^account_[1-9][0-9]*$'),
 display_name text not null, status text not null default 'not_configured' check (status in ('not_configured','stored','disabled')),
 encrypted_payload text, session_format text not null default 'cookie_useridtoken_json',
 updated_at timestamptz not null default now(), rotated_at timestamptz,
 check (status <> 'stored' or encrypted_payload is not null)
);
create table if not exists public.quillbot_user_controls (
 user_id uuid primary key references auth.users(id) on delete cascade,
 status text not null default 'active' check (status in ('active','suspended')),
 provider_account_key text not null default 'account_1' references public.quillbot_provider_accounts(account_key),
 device_limit integer not null default 2 check (device_limit between 1 and 10),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.quillbot_proxy_sessions (
 id uuid primary key default gen_random_uuid(), token_hash text not null unique,
 user_id uuid not null references auth.users(id) on delete cascade,
 source_kind text not null check (source_kind in ('order','grant')), source_id text not null,
 status text not null default 'issued' check (status in ('issued','active','expired','revoked')),
 provider_account_key text not null references public.quillbot_provider_accounts(account_key),
 device_fingerprint text, created_at timestamptz not null default now(),
 activated_at timestamptz, last_seen_at timestamptz, expires_at timestamptz not null
);
create index if not exists quillbot_proxy_sessions_user_idx on public.quillbot_proxy_sessions(user_id,created_at desc);
create index if not exists quillbot_proxy_sessions_expiry_idx on public.quillbot_proxy_sessions(status,expires_at);
create table if not exists public.quillbot_devices (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 device_fingerprint text not null check (device_fingerprint ~ '^[a-f0-9]{32}$'),
 first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
 unique(user_id,device_fingerprint)
);
alter table public.quillbot_provider_accounts enable row level security;
alter table public.quillbot_user_controls enable row level security;
alter table public.quillbot_proxy_sessions enable row level security;
alter table public.quillbot_devices enable row level security;
revoke all on public.quillbot_provider_accounts, public.quillbot_user_controls, public.quillbot_proxy_sessions, public.quillbot_devices from public,anon,authenticated;
grant all on public.quillbot_provider_accounts, public.quillbot_user_controls, public.quillbot_proxy_sessions, public.quillbot_devices to service_role;
insert into public.quillbot_provider_accounts(account_key,display_name) values ('account_1','Account 1') on conflict do nothing;
-- Atomic device registration prevents simultaneous new browsers exceeding the limit.
create or replace function public.register_quillbot_device(_user_id uuid, _fingerprint text)
returns boolean language plpgsql security invoker set search_path=public as $$
declare c public.quillbot_user_controls; n integer;
begin
 if _fingerprint !~ '^[a-f0-9]{32}$' then return false; end if;
 select * into c from public.quillbot_user_controls where user_id=_user_id for update;
 if not found or c.status <> 'active' then return false; end if;
 if exists(select 1 from public.quillbot_devices where user_id=_user_id and device_fingerprint=_fingerprint) then
  update public.quillbot_devices set last_seen_at=now() where user_id=_user_id and device_fingerprint=_fingerprint; return true;
 end if;
 select count(*) into n from public.quillbot_devices where user_id=_user_id;
 if n >= c.device_limit then
  update public.quillbot_user_controls set status='suspended',updated_at=now() where user_id=_user_id;
  update public.quillbot_proxy_sessions set status='revoked' where user_id=_user_id and status in ('issued','active');
  return false;
 end if;
 insert into public.quillbot_devices(user_id,device_fingerprint) values (_user_id,_fingerprint);
 return true;
end $$;
revoke all on function public.register_quillbot_device(uuid,text) from public,anon,authenticated;
grant execute on function public.register_quillbot_device(uuid,text) to service_role;
commit;
