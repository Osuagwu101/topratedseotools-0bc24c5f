
-- Remove client-side ability to self-grant subscription plan/status
DROP POLICY IF EXISTS "own sub update" ON public.user_subscriptions;

-- Admins can view/manage subscriptions (via service role/admin server fns)
CREATE POLICY "admins manage subscriptions" ON public.user_subscriptions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Admins can read contact form submissions
CREATE POLICY "admins read contact messages" ON public.contact_messages
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Explicit admin-only management of user_roles
CREATE POLICY "admins manage user roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
