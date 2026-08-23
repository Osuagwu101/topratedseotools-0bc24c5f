alter table public.custom_payment_transactions
  add column if not exists merchant_reference text,
  add column if not exists gateway_reference text;

update public.custom_payment_transactions
   set merchant_reference = coalesce(merchant_reference, reference),
       gateway_reference = coalesce(gateway_reference, case when payment_gateway = 'paystack' then reference else null end);

alter table public.custom_payment_links
  add column if not exists paid_gateway_reference text,
  add column if not exists paid_gateway_transaction_id text;

update public.custom_payment_links
   set paid_gateway_reference = coalesce(paid_gateway_reference, paid_reference)
 where status = 'paid';

create index if not exists custom_payment_transactions_merchant_reference_idx
  on public.custom_payment_transactions (link_id, merchant_reference);
create index if not exists custom_payment_transactions_gateway_reference_idx
  on public.custom_payment_transactions (gateway_reference);
create index if not exists custom_payment_transactions_gateway_txid_idx
  on public.custom_payment_transactions (payment_gateway, gateway_transaction_id);

create or replace function public.finalize_custom_payment_v2(
  _link_id uuid,
  _merchant_reference text,
  _gateway_reference text,
  _gateway_transaction_id text,
  _payer_name text,
  _payer_email text,
  _paid_at timestamp with time zone
) returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _link public.custom_payment_links%rowtype;
begin
  if _merchant_reference is null or length(_merchant_reference) = 0 then
    raise exception 'Merchant correlation key is required';
  end if;
  if coalesce(_gateway_reference, '') = '' and coalesce(_gateway_transaction_id, '') = '' then
    raise exception 'A gateway-issued identifier is required to finalize a custom payment';
  end if;

  select * into _link from public.custom_payment_links where id = _link_id for update;
  if not found then
    raise exception 'Custom payment link not found';
  end if;

  if _link.status = 'paid' then
    return (coalesce(_gateway_transaction_id, '') <> '' and _link.paid_gateway_transaction_id = _gateway_transaction_id)
        or (coalesce(_gateway_reference, '') <> '' and _link.paid_gateway_reference = _gateway_reference)
        or (_link.paid_reference = _merchant_reference);
  end if;

  update public.custom_payment_transactions
     set status = 'successful',
         gateway_reference = coalesce(_gateway_reference, gateway_reference),
         gateway_transaction_id = coalesce(_gateway_transaction_id, gateway_transaction_id),
         payer_name = coalesce(_payer_name, payer_name),
         payer_email = coalesce(nullif(_payer_email, ''), payer_email),
         paid_at = coalesce(paid_at, _paid_at),
         last_error = null,
         updated_at = now()
   where link_id = _link_id
     and merchant_reference = _merchant_reference;

  update public.custom_payment_links
     set status = 'paid',
         paid_at = _paid_at,
         paid_reference = coalesce(nullif(_gateway_reference, ''), nullif(_gateway_transaction_id, ''), _merchant_reference),
         paid_gateway_reference = nullif(_gateway_reference, ''),
         paid_gateway_transaction_id = nullif(_gateway_transaction_id, ''),
         updated_at = now()
   where id = _link_id;

  return true;
end;
$function$;

revoke all on function public.finalize_custom_payment_v2(uuid, text, text, text, text, text, timestamp with time zone) from public;
grant execute on function public.finalize_custom_payment_v2(uuid, text, text, text, text, text, timestamp with time zone) to service_role;