-- Phase 1: StealthWriter multi-provider-account foundation.
-- Adds an encrypted provider-account vault without changing customer routing yet.
-- The existing single StealthWriter vault remains the compatibility source during
-- this phase and is mirrored into Account 1 by a database trigger.

create table if not exists public.stealthwriter_provider_accounts (
  account_key text primary key
    check (account_key ~ '^account_[1-9][0-9]*$'),
  display_name text not null,
  sort_order integer not null unique
    check (sort_order between 1 and 100),
  status text not null default 'not_configured'
    check (status in ('not_configured', 'stored', 'disabled')),
  encrypted_payload text null,
  session_format text not null default 'better_auth_cookie_json',
  updated_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  rotated_at timestamptz null,
  check (status <> 'stored' or encrypted_payload is not null)
);

-- Preserve the already-working StealthWriter session byte-for-byte as Account 1.
-- No decryption occurs in SQL.
insert into public.stealthwriter_provider_accounts (
  account_key,
  display_name,
  sort_order,
  status,
  encrypted_payload,
  session_format,
  updated_by,
  created_at,
  updated_at,
  rotated_at
)
select
  'account_1',
  'Account 1',
  1,
  case when status = 'stored' then 'stored' else 'not_configured' end,
  encrypted_payload,
  session_format,
  updated_by,
  created_at,
  updated_at,
  rotated_at
from public.tool_authorized_sessions
where tool_slug = 'stealthwriter'
on conflict (account_key) do nothing;

-- Keep stable slots even if Phase 1 is installed before a session is configured.
insert into public.stealthwriter_provider_accounts (
  account_key,
  display_name,
  sort_order,
  status
)
values
  ('account_1', 'Account 1', 1, 'not_configured'),
  ('account_2', 'Account 2', 2, 'not_configured')
on conflict (account_key) do nothing;

alter table public.stealthwriter_provider_accounts enable row level security;

revoke all on table public.stealthwriter_provider_accounts
  from public, anon, authenticated;
grant all on table public.stealthwriter_provider_accounts
  to service_role;

-- Phase 1 compatibility bridge:
-- current admin replacement and upstream cookie rotation still write the legacy
-- single vault. Mirror every StealthWriter change into Account 1 so the new
-- multi-account vault stays current without changing production routing.
create or replace function public.sync_stealthwriter_account_1_from_legacy()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.tool_slug <> 'stealthwriter' then
    return new;
  end if;

  insert into public.stealthwriter_provider_accounts (
    account_key,
    display_name,
    sort_order,
    status,
    encrypted_payload,
    session_format,
    updated_by,
    updated_at,
    rotated_at
  )
  values (
    'account_1',
    'Account 1',
    1,
    case when new.status = 'stored' then 'stored' else 'not_configured' end,
    new.encrypted_payload,
    new.session_format,
    new.updated_by,
    new.updated_at,
    new.rotated_at
  )
  on conflict (account_key) do update
  set
    display_name = 'Account 1',
    sort_order = 1,
    status = excluded.status,
    encrypted_payload = excluded.encrypted_payload,
    session_format = excluded.session_format,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at,
    rotated_at = excluded.rotated_at;

  return new;
end;
$$;

revoke all on function public.sync_stealthwriter_account_1_from_legacy()
  from public, anon, authenticated;
grant execute on function public.sync_stealthwriter_account_1_from_legacy()
  to service_role;

drop trigger if exists sync_stealthwriter_account_1_from_legacy
  on public.tool_authorized_sessions;

create trigger sync_stealthwriter_account_1_from_legacy
after insert or update on public.tool_authorized_sessions
for each row
when (new.tool_slug = 'stealthwriter')
execute function public.sync_stealthwriter_account_1_from_legacy();

comment on table public.stealthwriter_provider_accounts is
  'Encrypted StealthWriter upstream provider-account vault. Phase 1 seeds Account 1 from the existing working session and reserves Account 2 without routing customers yet.';
comment on column public.stealthwriter_provider_accounts.account_key is
  'Stable internal provider-account key used for future sticky customer assignment.';
comment on column public.stealthwriter_provider_accounts.encrypted_payload is
  'AES-256-GCM encrypted Better Auth cookie JSON; never exposed to browser clients.';
