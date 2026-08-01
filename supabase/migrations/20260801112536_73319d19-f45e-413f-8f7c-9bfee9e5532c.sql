UPDATE public.payment_providers
SET last_test_status = NULL,
    last_test_message = NULL,
    last_test_at = NULL
WHERE slug = 'flutterwave'
  AND last_test_message ILIKE '%subaccount%';