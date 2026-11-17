begin;
create table if not exists public.chatgpt_history_attachments (
 id text primary key check(id ~ '^[0-9a-f]{64}$'),
 user_id uuid not null,
 thread_id uuid not null,
 provider_identity text not null,
 source_key text not null,
 encrypted_descriptor text not null,
 status text not null check(status in ('pending','ready','unavailable')),
 storage_key text,
 byte_size bigint check(byte_size between 0 and 26214400),
 sha256 text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 foreign key(thread_id,user_id) references public.chatgpt_history_threads(id,user_id) on delete cascade,
 check(status <> 'ready' or (storage_key is not null and byte_size is not null and sha256 ~ '^[0-9a-f]{64}$'))
);
create index if not exists chatgpt_attachments_user_thread on public.chatgpt_history_attachments(user_id,thread_id,id);
create table if not exists public.chatgpt_file_owners (
 provider_identity text not null,
 file_id text not null,
 user_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(provider_identity,file_id)
);
create index if not exists chatgpt_files_user on public.chatgpt_file_owners(user_id);
alter table public.chatgpt_history_attachments enable row level security;
alter table public.chatgpt_file_owners enable row level security;
revoke all on public.chatgpt_history_attachments,public.chatgpt_file_owners from public,anon,authenticated;
grant all on public.chatgpt_history_attachments,public.chatgpt_file_owners to service_role;
-- No client storage policy: only server service-role code may read encrypted blobs.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('chatgpt-private-attachments','chatgpt-private-attachments',false,50000000,array['application/json'])
 on conflict(id) do nothing;
-- Refuse deployment if an existing bucket was made public or given broad client access.
do $$ begin
 if exists(select 1 from storage.buckets where id='chatgpt-private-attachments' and public) then
  raise exception 'ChatGPT attachments bucket must be private';
 end if;
end $$;
commit;
