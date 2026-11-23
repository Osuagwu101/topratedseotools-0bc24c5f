-- Claude OneClick file uploads: each uploaded provider file belongs to one
-- writer on one provider account. Writers may only preview, download or attach
-- files they uploaded. Additive; no existing rows are modified.
create table if not exists public.claude_file_owners (
  provider_account_key text not null default 'account_1'
    references public.claude_provider_accounts(account_key),
  file_id text not null check (char_length(file_id) between 1 and 200),
  organization_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid,
  file_name text,
  created_at timestamptz not null default now(),
  primary key (provider_account_key, file_id)
);

create index if not exists claude_file_owners_user_idx
  on public.claude_file_owners (provider_account_key, user_id, created_at desc);

alter table public.claude_file_owners enable row level security;
revoke all on table public.claude_file_owners from anon;
revoke all on table public.claude_file_owners from authenticated;
grant all on table public.claude_file_owners to service_role;
