REVOKE ALL ON FUNCTION public.ensure_admin_account_is_not_customer() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_admin_account_is_not_customer() FROM anon;
REVOKE ALL ON FUNCTION public.ensure_admin_account_is_not_customer() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_admin_account_is_not_customer() TO service_role;

REVOKE ALL ON FUNCTION public.ensure_admin_role_registered() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_admin_role_registered() FROM anon;
REVOKE ALL ON FUNCTION public.ensure_admin_role_registered() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_admin_role_registered() TO service_role;