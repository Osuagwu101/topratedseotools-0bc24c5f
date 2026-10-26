-- ONLY for a disposable local Supabase stack, never production.
create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 account_status text not null default 'active'
);
create table if not exists public.tool_access_grants (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 tool_slug text not null,
 status text not null,
 expires_at timestamptz
);
create table if not exists public.tool_orders (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 tool_slug text not null,
 status text not null,
 payment_status text,
 expires_at timestamptz,
 access_type text,
 fulfilment_status text
);
alter table public.profiles enable row level security;
alter table public.tool_access_grants enable row level security;
alter table public.tool_orders enable row level security;
grant select,insert,update,delete on public.profiles, public.tool_access_grants, public.tool_orders to service_role;
