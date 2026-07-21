ALTER TABLE public.admin_accounts
  ADD COLUMN IF NOT EXISTS account_email text;

UPDATE public.admin_accounts
SET account_email = lower(trim(coalesce(account_email, email)))
WHERE account_email IS NULL
  AND email IS NOT NULL;

ALTER TABLE public.admin_accounts
  ALTER COLUMN account_email SET NOT NULL;

DROP INDEX IF EXISTS public.admin_accounts_email_lower_idx;
CREATE UNIQUE INDEX IF NOT EXISTS admin_accounts_account_email_key
  ON public.admin_accounts (account_email);

CREATE OR REPLACE FUNCTION public.ensure_admin_role_registered()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.role = 'admin' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.admin_accounts aa
      WHERE aa.user_id = NEW.user_id
    ) THEN
      RAISE EXCEPTION 'Admin role can only be assigned to a registered Admin account';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_admin_role_registered() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_admin_role_registered() FROM anon;
REVOKE ALL ON FUNCTION public.ensure_admin_role_registered() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_admin_role_registered() TO service_role;

CREATE OR REPLACE FUNCTION public.ensure_admin_account_is_not_customer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  normalized_email text;
BEGIN
  normalized_email := lower(trim(coalesce(NEW.account_email, NEW.email)));
  IF normalized_email IS NULL OR normalized_email = '' THEN
    RAISE EXCEPTION 'Admin email is required';
  END IF;

  NEW.account_email := normalized_email;
  NEW.email := normalized_email;

  IF EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE lower(trim(p.email)) = normalized_email
      AND p.id <> NEW.user_id
  ) THEN
    RAISE EXCEPTION 'This email is already registered as a customer. Please use a different email address for the Admin account.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_admin_account_is_not_customer() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_admin_account_is_not_customer() FROM anon;
REVOKE ALL ON FUNCTION public.ensure_admin_account_is_not_customer() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_admin_account_is_not_customer() TO service_role;

DROP TRIGGER IF EXISTS trg_admin_accounts_not_customer ON public.admin_accounts;
CREATE TRIGGER trg_admin_accounts_not_customer
BEFORE INSERT OR UPDATE OF user_id, email, account_email ON public.admin_accounts
FOR EACH ROW EXECUTE FUNCTION public.ensure_admin_account_is_not_customer();