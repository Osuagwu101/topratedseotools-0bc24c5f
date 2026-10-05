-- Turnitin Phase 6: isolated credit purchase payment finalisation.
-- Keeps Turnitin credit purchases separate from tool_orders/tool_payments.

begin;

alter table public.turnitin_credit_purchases
  add column if not exists payment_currency text not null default 'NGN',
  add column if not exists payment_amount numeric(12,2) null,
  add column if not exists gateway_environment text null,
  add column if not exists gateway_reference text null,
  add column if not exists gateway_transaction_id text null,
  add column if not exists initiated_at timestamptz null,
  add column if not exists verified_at timestamptz null,
  add column if not exists last_error text null;

alter table public.turnitin_credit_purchases
  drop constraint if exists turnitin_credit_purchases_payment_currency_chk;

alter table public.turnitin_credit_purchases
  add constraint turnitin_credit_purchases_payment_currency_chk
  check (payment_currency = 'NGN');

alter table public.turnitin_credit_purchases
  drop constraint if exists turnitin_credit_purchases_payment_amount_chk;

alter table public.turnitin_credit_purchases
  add constraint turnitin_credit_purchases_payment_amount_chk
  check (payment_amount is null or payment_amount > 0);

create index if not exists turnitin_credit_purchases_reference_idx
  on public.turnitin_credit_purchases (payment_reference)
  where payment_reference is not null;

create or replace function public.turnitin_finalize_credit_purchase(
  _purchase_id uuid,
  _reference text,
  _gateway_transaction_id text default null,
  _paid_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _purchase public.turnitin_credit_purchases%rowtype;
  _batch_id uuid;
  _paid timestamptz;
begin
  if _reference is null or btrim(_reference) = '' then
    raise exception 'TURNITIN_PAYMENT_REFERENCE_REQUIRED';
  end if;

  select *
  into _purchase
  from public.turnitin_credit_purchases
  where id = _purchase_id
  for update;

  if not found then
    raise exception 'TURNITIN_PURCHASE_NOT_FOUND';
  end if;

  if _purchase.payment_reference is null
     or _purchase.payment_reference <> _reference then
    raise exception 'TURNITIN_PAYMENT_REFERENCE_MISMATCH';
  end if;

  -- Browser-return verify and signed webhook may race. A paid purchase is
  -- already final and must return the existing batch without granting again.
  if _purchase.status = 'paid' then
    select id
    into _batch_id
    from public.turnitin_credit_batches
    where purchase_id = _purchase.id;

    if _batch_id is null then
      _batch_id := public.turnitin_grant_paid_purchase(_purchase.id);
    end if;
    return _batch_id;
  end if;

  if _purchase.status in ('cancelled', 'refunded') then
    raise exception 'TURNITIN_PURCHASE_NOT_PAYABLE';
  end if;

  _paid := coalesce(_paid_at, now());

  update public.turnitin_credit_purchases
  set status = 'paid',
      paid_at = _paid,
      expires_at = _paid + interval '7 days',
      payment_amount = coalesce(payment_amount, total_amount_ngn),
      payment_currency = 'NGN',
      gateway_transaction_id = coalesce(_gateway_transaction_id, gateway_transaction_id),
      verified_at = now(),
      last_error = null
  where id = _purchase.id;

  _batch_id := public.turnitin_grant_paid_purchase(_purchase.id);
  return _batch_id;
end;
$$;

revoke all on function public.turnitin_finalize_credit_purchase(uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.turnitin_finalize_credit_purchase(uuid, text, text, timestamptz)
  to service_role;

comment on function public.turnitin_finalize_credit_purchase(uuid, text, text, timestamptz) is
  'Idempotently marks one verified Turnitin credit purchase paid and grants its seven-day credit batch.';

commit;
