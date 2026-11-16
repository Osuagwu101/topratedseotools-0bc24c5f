-- Additive: preserve current writers, transcripts and quota usage on Account 1.
begin;
create table if not exists public.claude_provider_accounts (
 account_key text primary key check(account_key in ('account_1','account_2')),
 status text not null check(status in ('connected','needs_login','disabled')),
 verified_at timestamptz
);
alter table public.claude_provider_accounts enable row level security;
revoke all on public.claude_provider_accounts from public,anon,authenticated;
grant all on public.claude_provider_accounts to service_role;
insert into public.claude_provider_accounts(account_key,status) values
 ('account_1','connected'),('account_2','needs_login') on conflict do nothing;
alter table public.claude_user_controls add column if not exists provider_account_key text not null default 'account_1' references public.claude_provider_accounts(account_key);
alter table public.claude_proxy_sessions add column if not exists provider_account_key text not null default 'account_1' references public.claude_provider_accounts(account_key);
alter table public.claude_conversation_owners add column if not exists provider_account_key text not null default 'account_1' references public.claude_provider_accounts(account_key);
alter table public.claude_conversation_owners drop constraint if exists claude_conversation_owners_pkey;
alter table public.claude_conversation_owners add primary key(provider_account_key,conversation_id);
create index if not exists claude_owners_account_user_idx on public.claude_conversation_owners(provider_account_key,user_id,organization_id);
-- Assignment changes invalidate both unredeemed tickets and active sessions atomically.
create or replace function public.revoke_reassigned_claude_sessions() returns trigger
language plpgsql security invoker set search_path=public as $$
begin
 if new.provider_account_key is distinct from old.provider_account_key then
  update public.claude_proxy_sessions set status='revoked' where user_id=new.user_id and status in ('issued','active');
 end if;
 return new;
end $$;
revoke all on function public.revoke_reassigned_claude_sessions() from public,anon,authenticated;
grant execute on function public.revoke_reassigned_claude_sessions() to service_role;
drop trigger if exists revoke_reassigned_claude_sessions on public.claude_user_controls;
create trigger revoke_reassigned_claude_sessions after update of provider_account_key on public.claude_user_controls for each row execute function public.revoke_reassigned_claude_sessions();
commit;
