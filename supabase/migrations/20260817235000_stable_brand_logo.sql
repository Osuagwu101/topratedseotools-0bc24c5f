-- Brand asset hardening.
-- Keep email HTML off Lovable-internal /__l5e asset paths so external email
-- clients can fetch the same public logo used by the website and favicon.
update public.email_settings
set brand_logo_url = 'https://topratedseotools.com/favicon.png?v=20260817b',
    updated_at = now()
where id = true;
