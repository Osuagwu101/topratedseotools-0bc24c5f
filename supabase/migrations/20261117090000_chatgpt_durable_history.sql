begin;
-- History belongs to the permanent customer, never an order, grant, or proxy session.
create table if not exists public.chatgpt_history_threads (
 id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 title text not null default 'New chat',
 encrypted_snapshot text not null,
 version integer not null default 1,
 latest_provider_identity text not null,
 latest_upstream_id uuid not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(id,user_id)
);
create index if not exists chatgpt_history_user_updated on public.chatgpt_history_threads(user_id,updated_at desc,id);
create table if not exists public.chatgpt_history_links (
 provider_identity text not null,
 upstream_id uuid not null,
 provider_account_key text not null check(provider_account_key in ('account_1','account_2')),
 thread_id uuid not null,
 user_id uuid not null,
 created_at timestamptz not null default now(),
 primary key(provider_identity,upstream_id),
 foreign key(thread_id,user_id) references public.chatgpt_history_threads(id,user_id) on delete cascade
);
create index if not exists chatgpt_history_link_user on public.chatgpt_history_links(user_id,upstream_id);
create table if not exists public.chatgpt_history_resumes (
 token_hash text primary key,
 user_id uuid not null,
 thread_id uuid not null,
 proxy_session_id uuid not null references public.chatgpt_proxy_sessions(id) on delete cascade,
 upstream_id uuid,
 started_at timestamptz,
 expires_at timestamptz not null,
 foreign key(thread_id,user_id) references public.chatgpt_history_threads(id,user_id) on delete cascade
);
-- Older live processes have no history feature; they cannot accidentally read these tables.
alter table public.chatgpt_history_threads enable row level security;
alter table public.chatgpt_history_links enable row level security;
alter table public.chatgpt_history_resumes enable row level security;
revoke all on public.chatgpt_history_threads,public.chatgpt_history_links,public.chatgpt_history_resumes from public,anon,authenticated;
grant all on public.chatgpt_history_threads,public.chatgpt_history_links,public.chatgpt_history_resumes to service_role;
commit;
-- An explicit ledger distinguishes pre-existing upstream 404s from successful backups.
begin;
create table if not exists public.chatgpt_history_backup_issues (
 provider_account_key text not null check(provider_account_key in ('account_1','account_2')),
 conversation_id text not null,
 user_id uuid not null references auth.users(id) on delete cascade,
 status text not null check(status in ('upstream_missing','resolved')),
 checked_at timestamptz not null default now(),
 primary key(provider_account_key,conversation_id)
);
alter table public.chatgpt_history_backup_issues enable row level security;
revoke all on public.chatgpt_history_backup_issues from public,anon,authenticated;
grant all on public.chatgpt_history_backup_issues to service_role;
commit;
