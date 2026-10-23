BEGIN;
CREATE OR REPLACE FUNCTION public.admin_activity_log_reject_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $fn$
BEGIN
 RAISE EXCEPTION 'ADMIN_ACTIVITY_LOG_APPEND_ONLY' USING ERRCODE='P0001';
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_activity_log_reject_mutation() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS admin_activity_log_append_only ON public.admin_activity_log;
CREATE TRIGGER admin_activity_log_append_only BEFORE UPDATE OR DELETE ON public.admin_activity_log FOR EACH ROW EXECUTE FUNCTION public.admin_activity_log_reject_mutation();
CREATE INDEX IF NOT EXISTS admin_activity_log_target_lookup_idx ON public.admin_activity_log (target_type, target_id);
CREATE INDEX IF NOT EXISTS admin_activity_log_action_created_idx ON public.admin_activity_log (action, created_at DESC);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.admin_activity_log FROM PUBLIC, anon, authenticated;
COMMIT;