BEGIN;
CREATE OR REPLACE FUNCTION phrasly_internal.seed_entitled_features()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE
 eligible boolean := false;
 was_eligible boolean := false;
 restore_existing boolean := false;
 changed integer := 0;
BEGIN
 IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME NOT IN ('tool_orders','tool_access_grants') THEN
  RAISE EXCEPTION 'invalid_phrasly_entitlement_trigger';
 END IF;
 IF NEW.tool_slug IS DISTINCT FROM 'phrasly' THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='tool_access_grants' THEN
  eligible := NEW.status='active' AND (NEW.expires_at IS NULL OR NEW.expires_at>now());
  IF TG_OP='UPDATE' THEN
   was_eligible := OLD.tool_slug='phrasly' AND OLD.user_id=NEW.user_id AND OLD.status='active'
    AND (OLD.expires_at IS NULL OR OLD.expires_at>now());
  END IF;
 ELSE
  eligible := NEW.status::text='approved' AND NEW.payment_status='successful'
   AND (NEW.expires_at IS NULL OR NEW.expires_at>now())
   AND (NEW.access_type IS DISTINCT FROM 'private' OR NEW.fulfilment_status='active');
  IF TG_OP='UPDATE' THEN
   was_eligible := OLD.tool_slug='phrasly' AND OLD.user_id=NEW.user_id
    AND OLD.status::text='approved' AND OLD.payment_status='successful'
    AND (OLD.expires_at IS NULL OR OLD.expires_at>now())
    AND (OLD.access_type IS DISTINCT FROM 'private' OR OLD.fulfilment_status='active');
  END IF;
 END IF;
 IF NOT coalesce(eligible,false) THEN RETURN NEW; END IF;
 IF current_setting('role',true) IN ('anon','authenticated')
  AND NOT coalesce(public.has_role(auth.uid(),'admin'::public.app_role),false) THEN RETURN NEW; END IF;
 -- A new authorized source, or a source becoming eligible again, is a regrant.
 -- Idempotent updates to an already-active source preserve explicit revocation.
 restore_existing := TG_OP='INSERT' OR NOT coalesce(was_eligible,false);
 INSERT INTO public.phrasly_oneclick_feature_grants AS f
  (user_id,tool_id,feature_key,daily_limit,enabled,is_unlimited)
 VALUES (NEW.user_id,'phrasly','humanizer',20,true,true),
        (NEW.user_id,'phrasly','ai_detector',20,true,true)
 ON CONFLICT(user_id,tool_id,feature_key) DO UPDATE SET enabled=true,is_unlimited=true
 WHERE restore_existing AND (NOT f.enabled OR NOT f.is_unlimited);
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed>0 THEN
  INSERT INTO public.phrasly_oneclick_activity(user_id,event_type)
  VALUES(NEW.user_id,'entitlement_features_provisioned');
 END IF;
 RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION phrasly_internal.seed_entitled_features() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION phrasly_internal.seed_entitled_features() TO service_role;
COMMIT;
