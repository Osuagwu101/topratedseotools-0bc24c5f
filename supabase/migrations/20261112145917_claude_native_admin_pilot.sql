-- A separate purpose-specific ticket ledger; writer access cannot redeem these.
create table if not exists public.claude_native_admin_handoffs (
 id uuid primary key default gen_random_uuid(),
 token_hash text not null unique,
 user_id uuid not null references auth.users(id) on delete cascade,
 vault_updated_at timestamptz not null,
 status text not null default 'issued' check (status in ('issued','used')),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 used_at timestamptz null
);
create index if not exists claude_native_admin_handoffs_user_idx on public.claude_native_admin_handoffs(user_id,created_at desc);
alter table public.claude_native_admin_handoffs enable row level security;
revoke all on public.claude_native_admin_handoffs from public,anon,authenticated;
grant all on public.claude_native_admin_handoffs to service_role;
