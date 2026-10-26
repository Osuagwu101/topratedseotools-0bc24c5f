-- Phase 3 allocator matching AWS existing-assignment reuse and earliest-capacity selection.
-- No account credentials are exposed by this function.
BEGIN;
CREATE OR REPLACE FUNCTION public.phrasly_oneclick_assign_account(p_user uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE selected_id uuid;
BEGIN
 IF p_user IS NULL THEN RAISE EXCEPTION 'account_inactive'; END IF;
 -- Serialize assignment decisions so concurrent launch requests cannot overfill a pool.
 PERFORM pg_advisory_xact_lock(hashtext('phrasly_oneclick_allocator'));
 SELECT a.account_id INTO selected_id FROM public.phrasly_oneclick_assignments a
 JOIN public.phrasly_oneclick_accounts c ON c.id=a.account_id
 WHERE a.user_id=p_user AND a.tool_id='phrasly' AND c.enabled=true
 ORDER BY a.created_at,a.id LIMIT 1;
 IF selected_id IS NOT NULL THEN RETURN selected_id; END IF;
 SELECT c.id INTO selected_id FROM public.phrasly_oneclick_accounts c
 WHERE c.tool_id='phrasly' AND c.enabled=true
 AND (c.capacity IS NULL OR (
   SELECT count(*) FROM public.phrasly_oneclick_assignments a
   WHERE a.account_id=c.id
 ) < c.capacity)
 ORDER BY c.created_at,c.id LIMIT 1;
 IF selected_id IS NULL THEN RETURN NULL; END IF;
 INSERT INTO public.phrasly_oneclick_assignments(user_id,tool_id,account_id)
 VALUES(p_user,'phrasly',selected_id)
 ON CONFLICT(user_id,tool_id) DO UPDATE SET account_id=excluded.account_id
 RETURNING account_id INTO selected_id;
 RETURN selected_id;
END $$;
REVOKE ALL ON FUNCTION public.phrasly_oneclick_assign_account(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.phrasly_oneclick_assign_account(uuid) TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.phrasly_oneclick_activity_id_seq TO service_role;
COMMIT;
