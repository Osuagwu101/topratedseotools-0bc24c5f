BEGIN;
WITH entitled AS (
 SELECT DISTINCT p.id FROM public.profiles p
 WHERE p.account_status='active' AND (
  EXISTS (SELECT 1 FROM public.tool_access_grants a
   WHERE a.user_id=p.id AND a.tool_slug='phrasly' AND a.status='active'
    AND (a.expires_at IS NULL OR a.expires_at>now()))
  OR EXISTS (SELECT 1 FROM public.tool_orders o
   WHERE o.user_id=p.id AND o.tool_slug='phrasly' AND o.status='approved'
    AND o.payment_status='successful' AND (o.expires_at IS NULL OR o.expires_at>now())
    AND (o.access_type IS DISTINCT FROM 'private' OR o.fulfilment_status='active'))
 )
), changed AS (
 UPDATE public.phrasly_oneclick_feature_grants g SET is_unlimited=true
 FROM entitled e WHERE g.user_id=e.id AND g.tool_id='phrasly'
  AND g.feature_key IN ('humanizer','ai_detector') AND g.enabled AND NOT g.is_unlimited
 RETURNING g.user_id,g.feature_key
), audited AS (
 INSERT INTO public.phrasly_oneclick_activity(user_id,event_type,feature_key)
 SELECT user_id,'owner_requested_unlimited:20261028',feature_key FROM changed
 RETURNING user_id
)
SELECT (SELECT count(DISTINCT user_id) FROM changed) AS users_updated,
 (SELECT count(*) FROM changed) AS features_updated,
 (SELECT count(*) FROM audited) AS audit_events;
COMMIT;
