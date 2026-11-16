begin;
create table if not exists public.chatgpt_provider_accounts (
 account_key text primary key check(account_key in ('account_1','account_2')),
 status text not null default 'not_configured' check(status in ('not_configured','stored','revoked')),
 encrypted_payload text,
 updated_at timestamptz not null default now(),
 rotated_at timestamptz,
 verified_at timestamptz,
 updated_by uuid references auth.users(id) on delete set null,
 check(status <> 'stored' or encrypted_payload is not null)
);
alter table public.chatgpt_provider_accounts enable row level security;
revoke all on public.chatgpt_provider_accounts from public,anon,authenticated;
grant all on public.chatgpt_provider_accounts to service_role;
insert into public.chatgpt_provider_accounts(account_key,status,encrypted_payload,updated_at,rotated_at)
 select 'account_1',status,encrypted_payload,updated_at,rotated_at from public.tool_authorized_sessions where tool_slug='chatgpt'
 on conflict do nothing;
insert into public.chatgpt_provider_accounts(account_key) values('account_1'),('account_2') on conflict do nothing;
-- Keep legacy Account 1 saves and rotations compatible with rollback processes.
create or replace function public.sync_chatgpt_account_1() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 insert into public.chatgpt_provider_accounts(account_key,status,encrypted_payload,updated_at,rotated_at,updated_by)
 values('account_1',new.status,new.encrypted_payload,new.updated_at,new.rotated_at,new.updated_by)
 on conflict(account_key) do update set status=excluded.status,encrypted_payload=excluded.encrypted_payload,updated_at=excluded.updated_at,rotated_at=excluded.rotated_at,updated_by=excluded.updated_by;
 return new;
end $$;
revoke all on function public.sync_chatgpt_account_1() from public,anon,authenticated;
grant execute on function public.sync_chatgpt_account_1() to service_role;
drop trigger if exists sync_chatgpt_account_1 on public.tool_authorized_sessions;
create trigger sync_chatgpt_account_1 after insert or update on public.tool_authorized_sessions for each row when(new.tool_slug='chatgpt') execute function public.sync_chatgpt_account_1();
alter table public.chatgpt_user_controls add column if not exists provider_account_key text not null default 'account_1' references public.chatgpt_provider_accounts(account_key);
alter table public.chatgpt_proxy_sessions add column if not exists provider_account_key text not null default 'account_1' references public.chatgpt_provider_accounts(account_key);
alter table public.chatgpt_conversation_owners add column if not exists provider_account_key text not null default 'account_1' references public.chatgpt_provider_accounts(account_key);
alter table public.chatgpt_conversation_owners drop constraint if exists chatgpt_conversation_owners_pkey;
alter table public.chatgpt_conversation_owners add primary key(provider_account_key,conversation_id);
create index if not exists chatgpt_owner_account_user_idx on public.chatgpt_conversation_owners(provider_account_key,user_id);
create or replace function public.revoke_reassigned_chatgpt_sessions() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 if new.provider_account_key is distinct from old.provider_account_key then
  update public.chatgpt_proxy_sessions set status='revoked' where user_id=new.user_id and status in ('issued','active');
 end if;
 return new;
end $$;
revoke all on function public.revoke_reassigned_chatgpt_sessions() from public,anon,authenticated;
grant execute on function public.revoke_reassigned_chatgpt_sessions() to service_role;
drop trigger if exists revoke_reassigned_chatgpt_sessions on public.chatgpt_user_controls;
create trigger revoke_reassigned_chatgpt_sessions after update of provider_account_key on public.chatgpt_user_controls for each row execute function public.revoke_reassigned_chatgpt_sessions();
commit;
