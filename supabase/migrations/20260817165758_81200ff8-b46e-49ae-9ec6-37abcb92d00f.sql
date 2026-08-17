UPDATE public.payment_providers SET is_active = false WHERE slug <> 'paystack';
UPDATE public.payment_providers SET is_active = true, enabled = true WHERE slug = 'paystack';