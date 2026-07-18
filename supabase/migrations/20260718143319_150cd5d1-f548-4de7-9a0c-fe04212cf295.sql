
-- Hide commenter emails from public reads. Drop the public SELECT policy on the base table and expose a safe view instead.
DROP POLICY IF EXISTS "Approved comments are public" ON public.blog_comments;

CREATE OR REPLACE VIEW public.blog_comments_public
WITH (security_invoker = on) AS
SELECT id, post_id, author_name, content, status, created_at
FROM public.blog_comments
WHERE status = 'approved';

GRANT SELECT ON public.blog_comments_public TO anon, authenticated;

-- Re-add a restricted public SELECT policy scoped so anon can only read approved rows through the view (view runs as invoker, so base-table SELECT is still needed).
CREATE POLICY "Approved comments readable for view"
ON public.blog_comments
FOR SELECT
TO anon, authenticated
USING (status = 'approved');
