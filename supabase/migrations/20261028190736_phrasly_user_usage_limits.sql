BEGIN;
-- Unlimited is explicit; preserve the previous numeric cap and enabled state.
ALTER TABLE public.phrasly_oneclick_feature_grants
 ADD COLUMN IF NOT EXISTS is_unlimited boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.phrasly_oneclick_count_attempt(p_user uuid,p_feature text)
RETURNS TABLE(allowed boolean,used integer,daily_limit integer,resets_in integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE lim integer; uncapped boolean; current_used integer; today_wat date;
BEGIN
 IF p_user IS NULL OR p_feature IS NULL OR p_feature NOT IN ('humanizer','ai_detector','default') THEN
  RAISE EXCEPTION 'bad_feature';
 END IF;
 SELECT g.daily_limit,g.is_unlimited INTO lim,uncapped
 FROM public.phrasly_oneclick_feature_grants g
 WHERE g.user_id=p_user AND g.tool_id='phrasly' AND g.feature_key=p_feature AND g.enabled=true
 FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'no_access'; END IF;
 today_wat := (now() AT TIME ZONE 'Africa/Lagos')::date;
 INSERT INTO public.phrasly_oneclick_daily_usage AS u(user_id,tool_id,feature_key,day,used)
 VALUES(p_user,'phrasly',p_feature,today_wat,0)
 ON CONFLICT(user_id,tool_id,feature_key,day) DO NOTHING;
 SELECT u.used INTO current_used FROM public.phrasly_oneclick_daily_usage u
 WHERE u.user_id=p_user AND u.tool_id='phrasly' AND u.feature_key=p_feature AND u.day=today_wat FOR UPDATE;
 IF uncapped OR current_used < lim THEN
  UPDATE public.phrasly_oneclick_daily_usage u SET used=u.used+1
  WHERE u.user_id=p_user AND u.tool_id='phrasly' AND u.feature_key=p_feature AND u.day=today_wat
  RETURNING u.used INTO current_used;
  allowed := true;
 ELSE allowed := false; END IF;
 used := current_used; daily_limit := CASE WHEN uncapped THEN NULL ELSE lim END;
 resets_in := greatest(0,extract(epoch FROM (((today_wat+1)::timestamp AT TIME ZONE 'Africa/Lagos') - now()))::integer);
 RETURN NEXT;
END $function$;
REVOKE ALL ON FUNCTION public.phrasly_oneclick_count_attempt(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.phrasly_oneclick_count_attempt(uuid,text) TO service_role;
COMMIT;
