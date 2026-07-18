
DROP VIEW IF EXISTS public.blog_comments_public;
-- No public SELECT policy: only admins can read the base table directly.
-- Approved comments are served to visitors by a server function using a trusted server client.
REVOKE SELECT ON public.blog_comments FROM anon;
