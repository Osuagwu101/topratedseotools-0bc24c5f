
-- 1) Extend user_roles with active + super-admin flags
ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_super_admin boolean NOT NULL DEFAULT false;

-- 2) Update has_role to respect is_active (keeps existing signature/callers)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
      AND is_active = true
  );
$$;

-- 3) Super-admin helper
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role = 'admin'
      AND is_super_admin = true
      AND is_active = true
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated, service_role;

-- 4) Lock user_roles management to Super Admin only
DROP POLICY IF EXISTS "admins manage user roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins manage user roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users read own role" ON public.user_roles;

-- Users may read only their own role rows (needed by client isAdmin checks)
CREATE POLICY "user_roles_read_own"
  ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Super admin may read all admin rows (for admin management UI)
CREATE POLICY "user_roles_super_admin_read_all"
  ON public.user_roles FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));

-- Only super admin may insert/update/delete admin rows
CREATE POLICY "user_roles_super_admin_insert"
  ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "user_roles_super_admin_update"
  ON public.user_roles FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "user_roles_super_admin_delete"
  ON public.user_roles FOR DELETE TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    -- prevent deleting the last super admin
    AND NOT (is_super_admin = true
             AND (SELECT count(*) FROM public.user_roles WHERE role='admin' AND is_super_admin=true AND is_active=true) <= 1)
  );

-- 5) Guard triggers: prevent last super-admin from being demoted/deactivated
CREATE OR REPLACE FUNCTION public.protect_last_super_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE remaining int;
BEGIN
  IF (TG_OP = 'UPDATE'
      AND OLD.is_super_admin = true
      AND (NEW.is_super_admin = false OR NEW.is_active = false)) THEN
    SELECT count(*) INTO remaining
      FROM public.user_roles
      WHERE role='admin' AND is_super_admin=true AND is_active=true AND user_id <> OLD.user_id;
    IF remaining < 1 THEN
      RAISE EXCEPTION 'Cannot demote or deactivate the last super admin';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_protect_last_super_admin ON public.user_roles;
CREATE TRIGGER trg_protect_last_super_admin
  BEFORE UPDATE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.protect_last_super_admin();

-- 6) Promote the existing owner to Super Admin
UPDATE public.user_roles
   SET is_super_admin = true, is_active = true
 WHERE user_id = '7be067d4-4168-47a1-b3a9-9af9bac4326b'
   AND role = 'admin';
