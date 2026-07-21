CREATE TABLE IF NOT EXISTS public.admin_accounts (
  user_id uuid PRIMARY KEY,
  email text,
  full_name text,
  invited_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_accounts TO authenticated;
GRANT ALL ON public.admin_accounts TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS admin_accounts_email_lower_idx
  ON public.admin_accounts (lower(email))
  WHERE email IS NOT NULL;

ALTER TABLE public.admin_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins can view admin accounts" ON public.admin_accounts;
CREATE POLICY "Super admins can view admin accounts"
ON public.admin_accounts
FOR SELECT
TO authenticated
USING (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Super admins can create admin accounts" ON public.admin_accounts;
CREATE POLICY "Super admins can create admin accounts"
ON public.admin_accounts
FOR INSERT
TO authenticated
WITH CHECK (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Super admins can update admin accounts" ON public.admin_accounts;
CREATE POLICY "Super admins can update admin accounts"
ON public.admin_accounts
FOR UPDATE
TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Super admins can delete admin accounts" ON public.admin_accounts;
CREATE POLICY "Super admins can delete admin accounts"
ON public.admin_accounts
FOR DELETE
TO authenticated
USING (public.is_super_admin(auth.uid()));

DROP TRIGGER IF EXISTS trg_admin_accounts_touch_updated_at ON public.admin_accounts;
CREATE TRIGGER trg_admin_accounts_touch_updated_at
BEFORE UPDATE ON public.admin_accounts
FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

INSERT INTO public.admin_accounts (user_id, email, full_name)
SELECT ur.user_id, p.email, p.full_name
FROM public.user_roles ur
LEFT JOIN public.profiles p ON p.id = ur.user_id
WHERE ur.role = 'admin'
ON CONFLICT (user_id) DO UPDATE SET
  email = COALESCE(EXCLUDED.email, public.admin_accounts.email),
  full_name = COALESCE(EXCLUDED.full_name, public.admin_accounts.full_name),
  updated_at = now();

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

DROP TRIGGER IF EXISTS trg_user_roles_admin_registry ON public.user_roles;
CREATE TRIGGER trg_user_roles_admin_registry
BEFORE INSERT OR UPDATE OF user_id, role ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.ensure_admin_role_registered();