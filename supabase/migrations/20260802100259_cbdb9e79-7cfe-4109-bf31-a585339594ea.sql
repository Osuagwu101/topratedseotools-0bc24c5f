ALTER TABLE public.email_settings ALTER COLUMN brand_logo_url SET DEFAULT 'https://topratedseotools.com/__l5e/assets-v1/147b0b3f-0398-4309-87ad-9624e5934639/top-rated-seo-tools-logo.png';
UPDATE public.email_settings
SET brand_logo_url = 'https://topratedseotools.com/__l5e/assets-v1/147b0b3f-0398-4309-87ad-9624e5934639/top-rated-seo-tools-logo.png'
WHERE brand_logo_url IS NULL OR brand_logo_url = '' OR brand_logo_url LIKE '%top-rated-seo-tools-icon.png';