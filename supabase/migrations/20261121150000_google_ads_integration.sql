-- Google Ads conversion tracking: allow a google_ads row in marketing_integrations.
-- public_id holds the AW- conversion ID; config.purchase_label holds the conversion label.
ALTER TABLE public.marketing_integrations
  DROP CONSTRAINT IF EXISTS marketing_integrations_provider_check;
ALTER TABLE public.marketing_integrations
  ADD CONSTRAINT marketing_integrations_provider_check
  CHECK (provider IN ('meta_pixel','meta_capi','gtm','google_ads'));

INSERT INTO public.marketing_integrations (provider, enabled) VALUES ('google_ads', false)
ON CONFLICT (provider) DO NOTHING;
