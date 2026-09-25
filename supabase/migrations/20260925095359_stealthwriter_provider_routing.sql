-- Phase 4: bind every StealthWriter proxy session to one provider account.
-- Existing sessions pre-date provider routing and were all served by Account 1,
-- so they are backfilled to account_1 without interrupting current customers.

alter table public.stealthwriter_proxy_sessions
  add column if not exists provider_account_key text;

update public.stealthwriter_proxy_sessions
set provider_account_key = 'account_1'
where provider_account_key is null;

alter table public.stealthwriter_proxy_sessions
  alter column provider_account_key set default 'account_1';

alter table public.stealthwriter_proxy_sessions
  alter column provider_account_key set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'stealthwriter_proxy_sessions_provider_account_fkey'
      and conrelid = 'public.stealthwriter_proxy_sessions'::regclass
  ) then
    alter table public.stealthwriter_proxy_sessions
      add constraint stealthwriter_proxy_sessions_provider_account_fkey
      foreign key (provider_account_key)
      references public.stealthwriter_provider_accounts(account_key)
      on update cascade
      on delete restrict;
  end if;
end
$$;

create index if not exists stealthwriter_proxy_sessions_provider_account_idx
  on public.stealthwriter_proxy_sessions (provider_account_key);

comment on column public.stealthwriter_proxy_sessions.provider_account_key is
  'Sticky upstream StealthWriter provider account captured when the proxy launch is created.';
