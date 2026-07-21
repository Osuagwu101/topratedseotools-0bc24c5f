
-- =========================================================================
-- 1. tool_accounts
-- =========================================================================
CREATE TABLE public.tool_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_slug text NOT NULL,
  access_type text NOT NULL CHECK (access_type IN ('shared','private')),
  label text NOT NULL DEFAULT '',
  login_email text,
  login_password text,
  login_url text,
  login_notes text,
  one_click_login_url text,
  max_capacity integer NOT NULL DEFAULT 1 CHECK (max_capacity >= 1),
  expires_at timestamptz,
  status text NOT NULL DEFAULT 'working'
    CHECK (status IN ('working','login_failed','password_changed','suspended','expired','tool_unavailable','maintenance','other')),
  enabled boolean NOT NULL DEFAULT true,
  needs_capacity_review boolean NOT NULL DEFAULT false,
  last_health_check_at timestamptz,
  last_health_check_by uuid REFERENCES auth.users(id),
  last_health_check_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);
CREATE INDEX tool_accounts_tool_idx ON public.tool_accounts(tool_slug, access_type);
CREATE INDEX tool_accounts_status_idx ON public.tool_accounts(status) WHERE enabled = true;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tool_accounts TO authenticated;
GRANT ALL ON public.tool_accounts TO service_role;
ALTER TABLE public.tool_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tool_accounts admin all" ON public.tool_accounts
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'))
  WITH CHECK (has_role(auth.uid(),'admin'));

CREATE TRIGGER tool_accounts_touch BEFORE UPDATE ON public.tool_accounts
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- =========================================================================
-- 2. tool_account_assignments
-- =========================================================================
CREATE TABLE public.tool_account_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.tool_accounts(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.tool_orders(id) ON DELETE SET NULL,
  tool_slug text NOT NULL,
  access_type text NOT NULL CHECK (access_type IN ('shared','private')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','released','reassigned')),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  released_reason text,
  assigned_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tool_account_assignments_account_active_idx
  ON public.tool_account_assignments(account_id) WHERE status = 'active';
CREATE INDEX tool_account_assignments_user_idx
  ON public.tool_account_assignments(user_id, tool_slug);
-- Prevent double-active per (user, tool)
CREATE UNIQUE INDEX tool_account_assignments_one_active_per_user_tool
  ON public.tool_account_assignments(user_id, tool_slug)
  WHERE status = 'active';
-- Optional: one active per (order) — an order occupies at most one slot
CREATE UNIQUE INDEX tool_account_assignments_one_active_per_order
  ON public.tool_account_assignments(order_id)
  WHERE status = 'active' AND order_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tool_account_assignments TO authenticated;
GRANT ALL ON public.tool_account_assignments TO service_role;
ALTER TABLE public.tool_account_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "assignments admin all" ON public.tool_account_assignments
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'))
  WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "assignments owner read" ON public.tool_account_assignments
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER tool_account_assignments_touch BEFORE UPDATE ON public.tool_account_assignments
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- =========================================================================
-- 3. tool_account_audit
-- =========================================================================
CREATE TABLE public.tool_account_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES public.tool_accounts(id) ON DELETE SET NULL,
  from_account_id uuid REFERENCES public.tool_accounts(id) ON DELETE SET NULL,
  to_account_id uuid REFERENCES public.tool_accounts(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  order_id uuid REFERENCES public.tool_orders(id) ON DELETE SET NULL,
  action text NOT NULL,
  actor uuid REFERENCES auth.users(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tool_account_audit_account_idx ON public.tool_account_audit(account_id, created_at DESC);

GRANT SELECT, INSERT ON public.tool_account_audit TO authenticated;
GRANT ALL ON public.tool_account_audit TO service_role;
ALTER TABLE public.tool_account_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit admin all" ON public.tool_account_audit
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'))
  WITH CHECK (has_role(auth.uid(),'admin'));

-- =========================================================================
-- 4. tool_settings.full_pool_policy
-- =========================================================================
ALTER TABLE public.tool_settings
  ADD COLUMN IF NOT EXISTS full_pool_policy text NOT NULL DEFAULT 'awaiting_assignment'
    CHECK (full_pool_policy IN ('awaiting_assignment','block_new'));

-- =========================================================================
-- 5. Assignment engine (SECURITY DEFINER; concurrency-safe via row lock)
-- =========================================================================
-- Returns the assignment id (new or existing) if placed; NULL if no capacity.
CREATE OR REPLACE FUNCTION public.assign_tool_account_for_order(_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o RECORD;
  chosen_account uuid;
  existing_assignment uuid;
  active_count integer;
  new_assignment uuid;
BEGIN
  SELECT id, user_id, tool_slug, access_type, status, expires_at
    INTO o
    FROM public.tool_orders
    WHERE id = _order_id
    FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF o.status <> 'approved' THEN RETURN NULL; END IF;
  IF o.access_type IS NULL THEN RETURN NULL; END IF;

  -- Already assigned?
  SELECT id INTO existing_assignment
    FROM public.tool_account_assignments
    WHERE order_id = _order_id AND status = 'active'
    LIMIT 1;
  IF existing_assignment IS NOT NULL THEN
    RETURN existing_assignment;
  END IF;

  -- Also skip if user already has an active assignment for this tool
  SELECT id INTO existing_assignment
    FROM public.tool_account_assignments
    WHERE user_id = o.user_id AND tool_slug = o.tool_slug AND status = 'active'
    LIMIT 1;
  IF existing_assignment IS NOT NULL THEN
    RETURN existing_assignment;
  END IF;

  -- Pick account with the most available spaces; lock it to prevent overfill.
  SELECT a.id INTO chosen_account
    FROM public.tool_accounts a
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS c
      FROM public.tool_account_assignments x
      WHERE x.account_id = a.id AND x.status = 'active'
    ) usage ON true
    WHERE a.tool_slug = o.tool_slug
      AND a.access_type = o.access_type
      AND a.enabled = true
      AND a.status = 'working'
      AND (a.expires_at IS NULL OR a.expires_at > now())
      AND usage.c < a.max_capacity
    ORDER BY (a.max_capacity - usage.c) DESC, a.created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

  IF chosen_account IS NULL THEN RETURN NULL; END IF;

  -- Re-check capacity under the lock (defense in depth vs. concurrent inserts).
  SELECT count(*)::int INTO active_count
    FROM public.tool_account_assignments
    WHERE account_id = chosen_account AND status = 'active';
  IF active_count >= (SELECT max_capacity FROM public.tool_accounts WHERE id = chosen_account) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.tool_account_assignments
    (account_id, user_id, order_id, tool_slug, access_type, status, assigned_at)
  VALUES
    (chosen_account, o.user_id, o.id, o.tool_slug, o.access_type, 'active', now())
  RETURNING id INTO new_assignment;

  INSERT INTO public.tool_account_audit (account_id, user_id, order_id, action, actor, notes)
  VALUES (chosen_account, o.user_id, o.id, 'auto_assign', NULL, 'Auto-assigned on order approval');

  RETURN new_assignment;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_tool_account_for_order(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_tool_account_for_order(uuid) TO authenticated, service_role;

-- Release helper
CREATE OR REPLACE FUNCTION public.release_assignments_for_order(_order_id uuid, _reason text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE released integer;
BEGIN
  UPDATE public.tool_account_assignments
    SET status = 'released',
        released_at = now(),
        released_reason = _reason
    WHERE order_id = _order_id AND status = 'active';
  GET DIAGNOSTICS released = ROW_COUNT;
  RETURN released;
END;
$$;
REVOKE ALL ON FUNCTION public.release_assignments_for_order(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_assignments_for_order(uuid, text) TO authenticated, service_role;

-- Auto-release trigger on tool_orders status/payment_status changes
CREATE OR REPLACE FUNCTION public.tg_release_on_order_end()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE reason text;
BEGIN
  IF (NEW.status IN ('expired','cancelled','rejected') AND OLD.status <> NEW.status)
     OR (NEW.payment_status = 'refunded' AND OLD.payment_status <> 'refunded')
     OR (NEW.payment_status = 'reversed' AND OLD.payment_status <> 'reversed')
  THEN
    reason := COALESCE('order_' || NEW.status, 'payment_' || NEW.payment_status);
    PERFORM public.release_assignments_for_order(NEW.id, reason);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_release_on_order_end ON public.tool_orders;
CREATE TRIGGER trg_release_on_order_end
  AFTER UPDATE ON public.tool_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_release_on_order_end();

-- =========================================================================
-- 6. Backfill: migrate tool_credentials → tool_accounts + active assignments
-- =========================================================================
DO $$
DECLARE
  c RECORD;
  new_account_id uuid;
  active_shared_count integer;
  o RECORD;
BEGIN
  FOR c IN SELECT * FROM public.tool_credentials LOOP
    SELECT count(*)::int INTO active_shared_count
      FROM public.tool_orders
      WHERE tool_slug = c.tool_slug
        AND status = 'approved'
        AND COALESCE(access_type,'shared') = 'shared'
        AND (expires_at IS NULL OR expires_at > now());

    INSERT INTO public.tool_accounts (
      tool_slug, access_type, label,
      login_email, login_password, login_url, login_notes,
      max_capacity, status, enabled, needs_capacity_review
    ) VALUES (
      c.tool_slug, 'shared', 'Migrated account',
      c.login_email, c.login_password, c.login_url, c.login_notes,
      GREATEST(1, active_shared_count),
      'working', true, true
    ) RETURNING id INTO new_account_id;

    FOR o IN
      SELECT id, user_id FROM public.tool_orders
      WHERE tool_slug = c.tool_slug
        AND status = 'approved'
        AND COALESCE(access_type,'shared') = 'shared'
        AND (expires_at IS NULL OR expires_at > now())
    LOOP
      INSERT INTO public.tool_account_assignments
        (account_id, user_id, order_id, tool_slug, access_type, status, assigned_at)
      VALUES
        (new_account_id, o.user_id, o.id, c.tool_slug, 'shared', 'active', now())
      ON CONFLICT DO NOTHING;
    END LOOP;

    INSERT INTO public.tool_account_audit (account_id, action, notes)
    VALUES (new_account_id, 'migrated_from_tool_credentials',
            'Auto-migrated. Review capacity before adding new subscribers.');
  END LOOP;
END $$;
