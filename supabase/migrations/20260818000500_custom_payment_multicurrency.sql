-- Custom Payments only: make amount currency-neutral while keeping legacy NGN columns nullable for compatibility.

alter table public.custom_payment_links
  add column if not exists amount numeric;

update public.custom_payment_links
set amount = amount_ngn
where amount is null;

alter table public.custom_payment_links
  alter column amount_ngn drop not null;

alter table public.custom_payment_links
  drop constraint if exists custom_payment_links_amount_ngn_check;
alter table public.custom_payment_links
  drop constraint if exists custom_payment_links_currency_check;
alter table public.custom_payment_links
  add constraint custom_payment_links_amount_check check (amount > 0),
  add constraint custom_payment_links_currency_check check (currency ~ '^[A-Z]{3}$');

alter table public.custom_payment_transactions
  add column if not exists amount numeric;

update public.custom_payment_transactions
set amount = amount_ngn
where amount is null;

alter table public.custom_payment_transactions
  alter column amount_ngn drop not null;

alter table public.custom_payment_transactions
  drop constraint if exists custom_payment_transactions_amount_ngn_check;
alter table public.custom_payment_transactions
  drop constraint if exists custom_payment_transactions_currency_check;
alter table public.custom_payment_transactions
  add constraint custom_payment_transactions_amount_check check (amount > 0),
  add constraint custom_payment_transactions_currency_check check (currency ~ '^[A-Z]{3}$');

comment on column public.custom_payment_links.amount is 'Major-unit amount in currency; authoritative amount for Custom Payments.';
comment on column public.custom_payment_links.amount_ngn is 'Legacy compatibility only; populated only when currency=NGN.';
comment on column public.custom_payment_transactions.amount is 'Major-unit amount in currency; authoritative amount verified against Paystack.';
comment on column public.custom_payment_transactions.amount_ngn is 'Legacy compatibility only; populated only when currency=NGN.';
