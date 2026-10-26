-- Phase 3: isolated storage for the recovered AWS Phrasly extension contract.
-- This migration is intentionally not applied to production in Phase 3.
BEGIN;
CREATE TABLE IF NOT EXISTS public.phrasly_oneclick_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tool_id text NOT NULL DEFAULT 'phrasly',
 label text NOT NULL,
 target_url text NOT NULL,
 encrypted_cookies text NOT NULL,
 capacity integer NULL CHECK (capacity IS NULL OR capacity > 0),
 enabled boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS phrasly_oneclick_accounts_order_idx ON public.phrasly_oneclick_accounts(tool_id,created_at,id);
CREATE TABLE IF NOT EXISTS public.phrasly_oneclick_assignments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 tool_id text NOT NULL DEFAULT 'phrasly',
 account_id uuid NOT NULL REFERENCES public.phrasly_oneclick_accounts(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,tool_id)
);
CREATE INDEX IF NOT EXISTS phrasly_oneclick_assignments_capacity_idx ON public.phrasly_oneclick_assignments(account_id);
CREATE TABLE IF NOT EXISTS public.phrasly_oneclick_feature_grants (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 tool_id text NOT NULL DEFAULT 'phrasly',
 feature_key text NOT NULL CHECK(feature_key IN ('humanizer','ai_detector','default')),
 daily_limit integer NOT NULL CHECK(daily_limit > 0),
 enabled boolean NOT NULL DEFAULT false,
 PRIMARY KEY(user_id,tool_id,feature_key)
);
CREATE TABLE IF NOT EXISTS public.phrasly_oneclick_daily_usage (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 tool_id text NOT NULL DEFAULT 'phrasly',
 feature_key text NOT NULL CHECK(feature_key IN ('humanizer','ai_detector','default')),
 day date NOT NULL,
 used integer NOT NULL DEFAULT 0 CHECK(used >= 0),
 PRIMARY KEY(user_id,tool_id,feature_key,day)
);
CREATE TABLE IF NOT EXISTS public.phrasly_oneclick_activity (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 event_type text NOT NULL,
 feature_key text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.phrasly_oneclick_popup_sessions (
 token_hash text PRIMARY KEY CHECK(length(token_hash)=64),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS phrasly_oneclick_popup_sessions_expiry_idx ON public.phrasly_oneclick_popup_sessions(expires_at);
-- Keep Phrasly data inaccessible to browsers, including authenticated customers.
DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['phrasly_oneclick_accounts','phrasly_oneclick_assignments','phrasly_oneclick_feature_grants','phrasly_oneclick_daily_usage','phrasly_oneclick_activity','phrasly_oneclick_popup_sessions'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', t);
 END LOOP;
END $$;
-- Count an attempt before processing; reset on Africa/Lagos midnight.
-- This function is for trusted server-side calls only.
CREATE OR REPLACE FUNCTION public.phrasly_oneclick_count_attempt(p_user uuid,p_feature text)
RETURNS TABLE(allowed boolean, used integer, daily_limit integer, resets_in integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE lim integer; current_used integer; today_wat date;
BEGIN
 IF p_user IS NULL OR p_feature NOT IN ('humanizer','ai_detector','default') THEN
  RAISE EXCEPTION 'bad_feature';
 END IF;
 SELECT g.daily_limit INTO lim FROM public.phrasly_oneclick_feature_grants g
 WHERE g.user_id=p_user AND g.tool_id='phrasly' AND g.feature_key=p_feature AND g.enabled=true;
 IF lim IS NULL THEN RAISE EXCEPTION 'no_access'; END IF;
 today_wat := (now() AT TIME ZONE 'Africa/Lagos')::date;
 INSERT INTO public.phrasly_oneclick_daily_usage AS u(user_id,tool_id,feature_key,day,used)
 VALUES(p_user,'phrasly',p_feature,today_wat,0)
 ON CONFLICT(user_id,tool_id,feature_key,day) DO NOTHING;
 SELECT u.used INTO current_used FROM public.phrasly_oneclick_daily_usage u
 WHERE u.user_id=p_user AND u.tool_id='phrasly' AND u.feature_key=p_feature AND u.day=today_wat FOR UPDATE;
 IF current_used < lim THEN
  UPDATE public.phrasly_oneclick_daily_usage u SET used=u.used+1
   WHERE u.user_id=p_user AND u.tool_id='phrasly' AND u.feature_key=p_feature AND u.day=today_wat
   RETURNING u.used INTO current_used;
  allowed := true;
 ELSE allowed := false; END IF;
 used := current_used; daily_limit := lim;
 resets_in := greatest(0,extract(epoch FROM (((today_wat+1)::timestamp AT TIME ZONE 'Africa/Lagos') - now()))::integer);
 RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION public.phrasly_oneclick_count_attempt(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.phrasly_oneclick_count_attempt(uuid,text) TO service_role;
COMMIT;
