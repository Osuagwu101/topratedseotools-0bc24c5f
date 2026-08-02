ALTER TABLE public.email_settings ALTER COLUMN brand_color SET DEFAULT '#1e4e8c';

UPDATE public.email_settings
SET brand_color = '#1e4e8c'
WHERE brand_color IN ('#5b62f9', '#5B62F9');

UPDATE public.email_settings
SET brand_logo_url = 'https://topratedseotools.com/__l5e/assets-v1/f3e454df-dc80-4286-a457-12dd873e04bf/top-rated-seo-tools-icon.png'
WHERE brand_logo_url IS NULL OR btrim(brand_logo_url) = '';