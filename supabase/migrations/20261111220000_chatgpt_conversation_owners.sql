-- Per-customer ChatGPT history on the shared account.
-- The proxy records which TopRatedSEOTools user created each ChatGPT
-- conversation and only shows / opens / continues conversations a customer owns.
create table if not exists public.chatgpt_conversation_owners (
  conversation_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists chatgpt_conversation_owners_user_idx
  on public.chatgpt_conversation_owners (user_id, created_at desc);

alter table public.chatgpt_conversation_owners enable row level security;

revoke all on table public.chatgpt_conversation_owners from anon;
revoke all on table public.chatgpt_conversation_owners from authenticated;
grant all on table public.chatgpt_conversation_owners to service_role;
