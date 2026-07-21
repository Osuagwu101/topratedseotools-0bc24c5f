
ALTER TABLE public.ai_generator_settings
  ADD COLUMN IF NOT EXISTS brand_name text NOT NULL DEFAULT 'Top Rated SEO Tools',
  ADD COLUMN IF NOT EXISTS brand_url text NOT NULL DEFAULT 'https://topratedseotools.lovable.app',
  ADD COLUMN IF NOT EXISTS brand_description text NOT NULL DEFAULT 'Affordable access to premium SEO, AI, writing, research and productivity tools with Shared and Private Access plans (monthly, quarterly, yearly) via secure Paystack payments and a simple customer dashboard.',
  ADD COLUMN IF NOT EXISTS promo_position integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS promo_tone text NOT NULL DEFAULT 'Natural, professional and persuasive',
  ADD COLUMN IF NOT EXISTS promo_enabled boolean NOT NULL DEFAULT true;
