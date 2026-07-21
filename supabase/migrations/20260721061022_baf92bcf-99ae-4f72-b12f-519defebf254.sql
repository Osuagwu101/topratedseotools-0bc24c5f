
-- Remove overly permissive anon INSERT/UPDATE policies. Attribution + consent
-- are now written exclusively by server functions that use the service role
-- (which bypasses RLS), so anon needs no write access.
DROP POLICY IF EXISTS "Anyone can seed attribution" ON public.marketing_attribution;
DROP POLICY IF EXISTS "Anyone can update own attribution row" ON public.marketing_attribution;
DROP POLICY IF EXISTS "Anyone can insert consent" ON public.consent_choices;
DROP POLICY IF EXISTS "Anyone can update consent" ON public.consent_choices;

REVOKE INSERT, UPDATE ON public.marketing_attribution FROM anon, authenticated;
REVOKE INSERT, UPDATE ON public.consent_choices FROM anon, authenticated;

-- Add a no-op deny policy on marketing_events so the linter recognises the
-- deliberate "service-role writes only, admins read" pattern.
CREATE POLICY "Nobody writes marketing events from the app"
  ON public.marketing_events FOR INSERT TO authenticated
  WITH CHECK (false);
