-- One-time Custom Payments: admin-created public Paystack links that do not
-- create tool subscriptions or grant tool access.

create table if not exists public.custom_payment_links (
  id uuid primary key default gen_random_uuid(),
  public_token text not null unique,
  title text not null,
  description text,
  amount_ngn numeric(14,2) not null check (amount_ngn > 0),
  currency text not null default 'NGN' check (currency = 'NGN'),
  recipient_name text,
  recipient_email text,
  status text not null default 'active' check (status in ('active','paid','disabled')),
  expires_at timestamptz,
  paid_at timestamptz,
  paid_reference text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.custom_payment_transactions (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.custom_payment_links(id) on delete cascade,
  reference text not null unique,
  amount_ngn numeric(14,2) not null check (amount_ngn > 0),
  currency text not null default 'NGN' check (currency = 'NGN'),
  payer_name text,
  payer_email text not null,
  payment_gateway text not null default 'paystack',
  paystack_environment text not null default 'live',
  gateway_transaction_id text,
  status text not null default 'initiated' check (status in ('initiated','successful','failed')),
  initiated_at timestamptz not null default now(),
  paid_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists custom_payment_links_status_idx
  on public.custom_payment_links(status, created_at desc);
create index if not exists custom_payment_transactions_link_idx
  on public.custom_payment_transactions(link_id, created_at desc);

alter table public.custom_payment_links enable row level security;
alter table public.custom_payment_transactions enable row level security;

revoke all on public.custom_payment_links from anon, authenticated;
revoke all on public.custom_payment_transactions from anon, authenticated;
grant all on public.custom_payment_links to service_role;
grant all on public.custom_payment_transactions to service_role;

create or replace function public.finalize_custom_payment(
  _link_id uuid,
  _reference text,
  _gateway_transaction_id text,
  _payer_name text,
  _payer_email text,
  _paid_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  _link public.custom_payment_links%rowtype;
begin
  select * into _link
  from public.custom_payment_links
  where id = _link_id
  for update;

  if not found then
    raise exception 'Custom payment link not found';
  end if;

  update public.custom_payment_transactions
  set status = 'successful',
      gateway_transaction_id = coalesce(_gateway_transaction_id, gateway_transaction_id),
      payer_name = coalesce(_payer_name, payer_name),
      payer_email = coalesce(nullif(_payer_email, ''), payer_email),
      paid_at = coalesce(paid_at, _paid_at),
      last_error = null,
      updated_at = now()
  where link_id = _link_id and reference = _reference;

  if _link.status <> 'paid' then
    update public.custom_payment_links
    set status = 'paid',
        paid_at = _paid_at,
        paid_reference = _reference,
        updated_at = now()
    where id = _link_id;
    return true;
  end if;

  return _link.paid_reference = _reference;
end;
$$;

revoke all on function public.finalize_custom_payment(uuid,text,text,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.finalize_custom_payment(uuid,text,text,text,text,timestamptz) to service_role;
