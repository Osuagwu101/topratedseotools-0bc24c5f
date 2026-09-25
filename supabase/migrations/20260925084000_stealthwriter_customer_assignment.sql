-- Phase 3: StealthWriter customer-to-provider-account assignment.
-- This phase stores Admin assignment only. The proxy does not consume this
-- field until the next explicitly approved routing phase.

alter table public.stealthwriter_user_controls
  add column if not exists provider_account_key text;

-- Preserve every existing customer's current live behavior.
update public.stealthwriter_user_controls
set provider_account_key = 'account_1'
where provider_account_key is null;

alter table public.stealthwriter_user_controls
  alter column provider_account_key set default 'account_1';

alter table public.stealthwriter_user_controls
  alter column provider_account_key set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'stealthwriter_user_controls_provider_account_fkey'
      and conrelid = 'public.stealthwriter_user_controls'::regclass
  ) then
    alter table public.stealthwriter_user_controls
      add constraint stealthwriter_user_controls_provider_account_fkey
      foreign key (provider_account_key)
      references public.stealthwriter_provider_accounts(account_key)
      on update cascade
      on delete restrict;
  end if;
end
$$;

create index if not exists stealthwriter_user_controls_provider_account_idx
  on public.stealthwriter_user_controls (provider_account_key);

comment on column public.stealthwriter_user_controls.provider_account_key is
  'Admin-selected upstream StealthWriter provider account. Phase 3 stores assignment only; proxy routing is activated in a later approved phase.';
