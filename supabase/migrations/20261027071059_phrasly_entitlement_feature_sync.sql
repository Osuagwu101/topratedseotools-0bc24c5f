-- Keep the native AWS-compatible feature grants in step with TopRated entitlements.
-- 20 per feature is the existing Phrasly owner-screen default; existing overrides win.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE SCHEMA IF NOT EXISTS phrasly_internal;
REVOKE ALL ON SCHEMA phrasly_internal FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION phrasly_internal.seed_entitled_features()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  eligible boolean := false;
  added integer := 0;
BEGIN
  IF TG_TABLE_SCHEMA <> 'public'
     OR TG_TABLE_NAME NOT IN ('tool_orders', 'tool_access_grants') THEN
    RAISE EXCEPTION 'invalid_phrasly_entitlement_trigger';
  END IF;
  IF NEW.tool_slug IS DISTINCT FROM 'phrasly' THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'tool_access_grants' THEN
    eligible := NEW.status = 'active'
      AND (NEW.expires_at IS NULL OR NEW.expires_at > now());
  ELSE
    eligible := NEW.status::text = 'approved'
      AND NEW.payment_status = 'successful'
      AND (NEW.expires_at IS NULL OR NEW.expires_at > now())
      AND (NEW.access_type IS DISTINCT FROM 'private' OR NEW.fulfilment_status = 'active');
  END IF;
  IF NOT coalesce(eligible, false) THEN
    RETURN NEW;
  END IF;

  -- Cross-table writes need a definer trigger because an authenticated Admin
  -- can write orders under existing RLS but cannot directly edit native grants.
  -- A customer-supplied order must never provision native permissions.
  IF current_setting('role', true) IN ('anon', 'authenticated')
     AND NOT coalesce(public.has_role(auth.uid(), 'admin'::public.app_role), false) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.phrasly_oneclick_feature_grants
    (user_id, tool_id, feature_key, daily_limit, enabled)
  VALUES
    (NEW.user_id, 'phrasly', 'humanizer', 20, true),
    (NEW.user_id, 'phrasly', 'ai_detector', 20, true)
  ON CONFLICT (user_id, tool_id, feature_key) DO NOTHING;
  GET DIAGNOSTICS added = ROW_COUNT;
  IF added > 0 THEN
    INSERT INTO public.phrasly_oneclick_activity (user_id, event_type)
    VALUES (NEW.user_id, 'entitlement_features_seeded');
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION phrasly_internal.seed_entitled_features()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION phrasly_internal.seed_entitled_features() TO service_role;

CREATE OR REPLACE TRIGGER phrasly_seed_features_after_admin_access
AFTER INSERT OR UPDATE OF user_id, tool_slug, status, expires_at
ON public.tool_access_grants
FOR EACH ROW WHEN (NEW.tool_slug = 'phrasly')
EXECUTE FUNCTION phrasly_internal.seed_entitled_features();

CREATE OR REPLACE TRIGGER phrasly_seed_features_after_paid_order
AFTER INSERT OR UPDATE OF user_id, tool_slug, status, payment_status, expires_at,
  access_type, fulfilment_status
ON public.tool_orders
FOR EACH ROW WHEN (NEW.tool_slug = 'phrasly')
EXECUTE FUNCTION phrasly_internal.seed_entitled_features();

-- Repair only missing permissions for currently entitled users. Existing
-- limits, explicit feature revocations, counters and source entitlements stay intact.
WITH entitled AS (
  SELECT user_id FROM public.tool_access_grants
  WHERE tool_slug = 'phrasly' AND status = 'active'
    AND (expires_at IS NULL OR expires_at > now())
  UNION
  SELECT user_id FROM public.tool_orders
  WHERE tool_slug = 'phrasly' AND status::text = 'approved'
    AND payment_status = 'successful'
    AND (expires_at IS NULL OR expires_at > now())
    AND (access_type IS DISTINCT FROM 'private' OR fulfilment_status = 'active')
), inserted AS (
  INSERT INTO public.phrasly_oneclick_feature_grants
    (user_id, tool_id, feature_key, daily_limit, enabled)
  SELECT e.user_id, 'phrasly', f.feature_key, 20, true
  FROM entitled e
  CROSS JOIN (VALUES ('humanizer'), ('ai_detector')) AS f(feature_key)
  ON CONFLICT (user_id, tool_id, feature_key) DO NOTHING
  RETURNING user_id
)
INSERT INTO public.phrasly_oneclick_activity (user_id, event_type)
SELECT DISTINCT user_id, 'entitlement_features_backfilled' FROM inserted;
COMMIT;
