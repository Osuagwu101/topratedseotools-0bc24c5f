
-- Remove anon SELECT on the base table so author_email cannot be queried directly.
DROP POLICY IF EXISTS "Approved comments readable for view" ON public.blog_comments;

-- Recreate the view as SECURITY DEFINER-equivalent by owning it as postgres and using security_invoker=off,
-- so anon reads via the view bypass base-table RLS while direct base-table access stays admin-only.
DROP VIEW IF EXISTS public.blog_comments_public;
CREATE VIEW public.blog_comments_public
WITH (security_invoker = off) AS
SELECT id, post_id, author_name, content, status, created_at
FROM public.blog_comments
WHERE status = 'approved';

GRANT SELECT ON public.blog_comments_public TO anon, authenticated;
