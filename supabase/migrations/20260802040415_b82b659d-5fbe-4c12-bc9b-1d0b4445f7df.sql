ALTER TABLE public.email_settings
  ADD COLUMN IF NOT EXISTS brand_name text NOT NULL DEFAULT 'Top Rated SEO Tools',
  ADD COLUMN IF NOT EXISTS brand_color text NOT NULL DEFAULT '#5b62f9',
  ADD COLUMN IF NOT EXISTS brand_logo_url text,
  ADD COLUMN IF NOT EXISTS footer_company text NOT NULL DEFAULT 'Top Rated SEO Tools',
  ADD COLUMN IF NOT EXISTS footer_support_email text NOT NULL DEFAULT 'support@topratedseotools.com',
  ADD COLUMN IF NOT EXISTS footer_website_url text NOT NULL DEFAULT 'https://topratedseotools.com',
  ADD COLUMN IF NOT EXISTS footer_message text NOT NULL DEFAULT 'Premium SEO, AI and productivity tools.';