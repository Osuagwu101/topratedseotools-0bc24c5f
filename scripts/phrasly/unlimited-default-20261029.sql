BEGIN;
WITH changed AS (
 UPDATE public.phrasly_oneclick_feature_grants SET is_unlimited=true
 WHERE tool_id='phrasly' AND feature_key IN ('humanizer','ai_detector') AND enabled AND NOT is_unlimited
 RETURNING user_id,feature_key
), audited AS (
 INSERT INTO public.phrasly_oneclick_activity(user_id,event_type,feature_key)
 SELECT user_id,'owner_requested_unlimited:20261029',feature_key FROM changed RETURNING user_id
)
SELECT (SELECT count(*) FROM changed) AS features_updated,(SELECT count(*) FROM audited) AS audit_events;
COMMIT;
