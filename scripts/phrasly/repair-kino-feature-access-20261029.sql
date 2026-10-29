BEGIN;
WITH changed AS (
 UPDATE public.phrasly_oneclick_feature_grants f SET enabled=true,is_unlimited=true
 WHERE f.user_id='00ea9aae-dd51-4ec8-8a9f-3f52fb28ccca' AND f.tool_id='phrasly'
 AND f.feature_key IN ('humanizer','ai_detector') AND NOT f.enabled
 AND EXISTS(SELECT 1 FROM public.tool_orders o WHERE o.user_id=f.user_id AND o.tool_slug='phrasly'
  AND o.status::text='approved' AND o.payment_status='successful'
  AND (o.expires_at IS NULL OR o.expires_at>now())
  AND (o.access_type IS DISTINCT FROM 'private' OR o.fulfilment_status='active'))
 RETURNING user_id,feature_key
), audited AS (
 INSERT INTO public.phrasly_oneclick_activity(user_id,event_type,feature_key)
 SELECT user_id,'reassignment_feature_repair:20261029',feature_key FROM changed RETURNING user_id
)
SELECT (SELECT count(*) FROM changed) AS restored_features,(SELECT count(*) FROM audited) AS audit_events;
COMMIT;
