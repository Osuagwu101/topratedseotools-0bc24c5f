-- Shared ChatGPT projects granted to one writer.
-- When the upstream ChatGPT account is invited to collaborate on a project,
-- an admin can grant one writer that project: the writer sees every chat in
-- it, and the project is hidden from every other writer.
create table if not exists public.chatgpt_project_grants (
  provider_account_key text not null check (provider_account_key in ('account_1','account_2')),
  project_id text not null check (project_id ~ '^g-p-[0-9a-f]{32}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_name text,
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (provider_account_key, project_id)
);
create index if not exists chatgpt_project_grants_user_idx on public.chatgpt_project_grants (user_id);

-- Chats the proxy has seen inside granted projects (including chats started
-- by collaborators outside the site), so the granted writer can open them.
create table if not exists public.chatgpt_project_conversations (
  provider_account_key text not null check (provider_account_key in ('account_1','account_2')),
  conversation_id text not null,
  project_id text not null check (project_id ~ '^g-p-[0-9a-f]{32}$'),
  created_at timestamptz not null default now(),
  primary key (provider_account_key, conversation_id)
);
create index if not exists chatgpt_project_conversations_project_idx
  on public.chatgpt_project_conversations (provider_account_key, project_id);

alter table public.chatgpt_project_grants enable row level security;
alter table public.chatgpt_project_conversations enable row level security;
revoke all on table public.chatgpt_project_grants from anon, authenticated;
revoke all on table public.chatgpt_project_conversations from anon, authenticated;
grant all on table public.chatgpt_project_grants to service_role;
grant all on table public.chatgpt_project_conversations to service_role;
