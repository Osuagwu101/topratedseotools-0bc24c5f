-- Custom Payments: persist the selected gateway on each payment link so a
-- later global gateway change cannot reroute an existing bill.

alter table public.custom_payment_links
  add column if not exists payment_gateway text;

update public.custom_payment_links
set payment_gateway = 'paystack'
where payment_gateway is null;

alter table public.custom_payment_links
  alter column payment_gateway set default 'paystack',
  alter column payment_gateway set not null;

alter table public.custom_payment_links
  drop constraint if exists custom_payment_links_payment_gateway_check;
alter table public.custom_payment_links
  add constraint custom_payment_links_payment_gateway_check
  check (payment_gateway in ('paystack', 'flutterwave'));

alter table public.custom_payment_transactions
  add column if not exists gateway_environment text;

update public.custom_payment_transactions
set gateway_environment = coalesce(paystack_environment, 'live')
where gateway_environment is null;

alter table public.custom_payment_transactions
  alter column gateway_environment set default 'live',
  alter column gateway_environment set not null;

alter table public.custom_payment_transactions
  drop constraint if exists custom_payment_transactions_payment_gateway_check;
alter table public.custom_payment_transactions
  add constraint custom_payment_transactions_payment_gateway_check
  check (payment_gateway in ('paystack', 'flutterwave'));

alter table public.custom_payment_transactions
  drop constraint if exists custom_payment_transactions_gateway_environment_check;
alter table public.custom_payment_transactions
  add constraint custom_payment_transactions_gateway_environment_check
  check (gateway_environment in ('test', 'live'));

create index if not exists custom_payment_links_gateway_idx
  on public.custom_payment_links(payment_gateway, created_at desc);

comment on column public.custom_payment_links.payment_gateway is
  'Gateway selected when the Custom Payment link was created. Immutable for checkout routing.';
comment on column public.custom_payment_transactions.gateway_environment is
  'Gateway credential environment used for this Custom Payment attempt.';
comment on column public.custom_payment_transactions.amount is
  'Major-unit amount in currency; authoritative amount verified against the selected payment gateway.';
