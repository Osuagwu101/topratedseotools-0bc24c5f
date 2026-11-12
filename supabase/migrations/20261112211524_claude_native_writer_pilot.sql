-- Selected test writers only; credentials stay in the existing vault.
create table if not exists public.claude_native_pilot_writers (
 user_id uuid primary key references auth.users(id) on delete cascade,
 enabled boolean not null default true,
 expires_at timestamptz not null,
 granted_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 notes text
);
alter table public.claude_native_pilot_writers enable row level security;
revoke all on public.claude_native_pilot_writers from public,anon,authenticated;
grant all on public.claude_native_pilot_writers to service_role;
alter table public.claude_native_admin_handoffs add column if not exists audience text not null default 'admin' check (audience in ('admin','writer'));
