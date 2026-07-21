-- Phase 1 — Admin Control Foundation
-- Adds role_key on admin_accounts, permission overrides, invitations metadata,
-- activity log, and a single-source-of-truth effective-permission resolver.

-- 1) admin_accounts.role_key
ALTER TABLE public.admin_accounts
  ADD COLUMN IF NOT EXISTS role_key text
    CHECK (role_key IS NULL OR role_key IN ('operations','finance','support','content','marketing'));

-- 2) admin_permissions (individual overrides)
CREATE TABLE IF NOT EXISTS public.admin_permissions (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  permission text NOT NULL,
  granted boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  PRIMARY KEY (user_id, permission)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_permissions TO authenticated;
GRANT ALL ON public.admin_permissions TO service_role;
ALTER TABLE public.admin_permissions ENABLE ROW LEVEL SECURITY;

-- 3) admin_invitations (metadata paired with Supabase Auth invite)
CREATE TABLE IF NOT EXISTS public.admin_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  role_key text,
  invited_by uuid,
  auth_user_id uuid,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','expired','revoked')),
  expires_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_invitations_email_idx ON public.admin_invitations(lower(email));
CREATE INDEX IF NOT EXISTS admin_invitations_status_idx ON public.admin_invitations(status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_invitations TO authenticated;
GRANT ALL ON public.admin_invitations TO service_role;
ALTER TABLE public.admin_invitations ENABLE ROW LEVEL SECURITY;

-- 4) admin_activity_log (append-only)
CREATE TABLE IF NOT EXISTS public.admin_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid,
  actor_email text,
  actor_role text,
  action text NOT NULL,
  area text,
  target_type text,
  target_id text,
  success boolean NOT NULL DEFAULT true,
  reason text,
  reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_activity_log_created_idx ON public.admin_activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS admin_activity_log_actor_idx ON public.admin_activity_log(actor_user_id);
GRANT SELECT ON public.admin_activity_log TO authenticated;
GRANT ALL ON public.admin_activity_log TO service_role;
ALTER TABLE public.admin_activity_log ENABLE ROW LEVEL SECURITY;

-- 5) admin_effective_permission — single source of truth
CREATE OR REPLACE FUNCTION public.admin_effective_permission(_uid uuid, _perm text)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_active_admin boolean;
  is_super boolean;
  role_key_v text;
  has_override boolean;
  override_granted boolean;
  role_default boolean := false;
BEGIN
  SELECT (ur.is_active IS TRUE) INTO is_active_admin
    FROM public.user_roles ur
    WHERE ur.user_id = _uid AND ur.role = 'admin'
    LIMIT 1;
  IF is_active_admin IS NOT TRUE THEN RETURN false; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.admin_accounts WHERE user_id = _uid) THEN
    RETURN false;
  END IF;

  SELECT ur.is_super_admin INTO is_super
    FROM public.user_roles ur
    WHERE ur.user_id = _uid AND ur.role = 'admin' LIMIT 1;
  IF is_super IS TRUE THEN RETURN true; END IF;

  SELECT ap.granted INTO override_granted
    FROM public.admin_permissions ap
    WHERE ap.user_id = _uid AND ap.permission = _perm
    LIMIT 1;
  has_override := FOUND;
  IF has_override THEN RETURN override_granted; END IF;

  SELECT aa.role_key INTO role_key_v FROM public.admin_accounts aa WHERE aa.user_id = _uid;

  role_default := CASE
    WHEN role_key_v = 'operations' AND _perm IN (
      'customers.view','customers.edit','orders.manage','subscriptions.manage','credentials.view'
    ) THEN true
    WHEN role_key_v = 'finance' AND _perm IN (
      'customers.view','orders.manage','payments.manage','refunds.process','subscriptions.manage'
    ) THEN true
    WHEN role_key_v = 'support' AND _perm IN (
      'customers.view','support.manage','orders.manage'
    ) THEN true
    WHEN role_key_v = 'content' AND _perm IN (
      'content.manage','promotions.manage'
    ) THEN true
    WHEN role_key_v = 'marketing' AND _perm IN (
      'marketing.manage','emails.manage','promotions.manage'
    ) THEN true
    ELSE false
  END;

  RETURN role_default;
END; $$;

REVOKE ALL ON FUNCTION public.admin_effective_permission(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_effective_permission(uuid, text) TO authenticated, service_role;

-- 6) Extend protect_last_super_admin to also block DELETE
CREATE OR REPLACE FUNCTION public.protect_last_super_admin()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE remaining int;
BEGIN
  IF TG_OP = 'DELETE'
     AND OLD.is_super_admin = true
     AND OLD.role = 'admin'
     AND OLD.is_active = true THEN
    SELECT count(*) INTO remaining
      FROM public.user_roles
      WHERE role='admin' AND is_super_admin=true AND is_active=true AND user_id <> OLD.user_id;
    IF remaining < 1 THEN
      RAISE EXCEPTION 'Cannot delete the last super admin';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE'
      AND OLD.is_super_admin = true
      AND OLD.role = 'admin'
      AND OLD.is_active = true
      AND (NEW.is_super_admin = false OR NEW.is_active = false OR NEW.role <> 'admin') THEN
    SELECT count(*) INTO remaining
      FROM public.user_roles
      WHERE role='admin' AND is_super_admin=true AND is_active=true AND user_id <> OLD.user_id;
    IF remaining < 1 THEN
      RAISE EXCEPTION 'Cannot demote or deactivate the last super admin';
    END IF;
  END IF;
  RETURN NEW;
END; $function$;

DROP TRIGGER IF EXISTS user_roles_protect_last_super_admin ON public.user_roles;
CREATE TRIGGER user_roles_protect_last_super_admin
  BEFORE UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.protect_last_super_admin();

-- 7) RLS policies

-- admin_permissions: super-admins only
DROP POLICY IF EXISTS "super admins read admin_permissions" ON public.admin_permissions;
CREATE POLICY "super admins read admin_permissions" ON public.admin_permissions
  FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "super admins write admin_permissions" ON public.admin_permissions;
CREATE POLICY "super admins write admin_permissions" ON public.admin_permissions
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- admin_invitations: super-admins only
DROP POLICY IF EXISTS "super admins read admin_invitations" ON public.admin_invitations;
CREATE POLICY "super admins read admin_invitations" ON public.admin_invitations
  FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "super admins write admin_invitations" ON public.admin_invitations;
CREATE POLICY "super admins write admin_invitations" ON public.admin_invitations
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- admin_activity_log: SELECT for super admins OR audit.view permission
DROP POLICY IF EXISTS "activity log read" ON public.admin_activity_log;
CREATE POLICY "activity log read" ON public.admin_activity_log
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR public.admin_effective_permission(auth.uid(), 'audit.view')
  );
-- No INSERT/UPDATE/DELETE policies — writes are service_role only.

-- 8) Backfill role_key for existing non-super admins to a safe default
UPDATE public.admin_accounts aa
  SET role_key = 'operations'
  WHERE role_key IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = aa.user_id AND ur.role='admin' AND ur.is_super_admin=true
    );
