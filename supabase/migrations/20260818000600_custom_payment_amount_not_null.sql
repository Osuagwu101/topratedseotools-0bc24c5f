-- Every Custom Payment must have an authoritative currency-neutral major-unit amount.
alter table public.custom_payment_links alter column amount set not null;
alter table public.custom_payment_transactions alter column amount set not null;
