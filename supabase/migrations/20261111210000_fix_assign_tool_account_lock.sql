-- Auto-assign failed on every order with
--   "FOR UPDATE is not allowed with aggregate functions" (0A000)
-- because FOR UPDATE tried to lock the LATERAL count(*) subquery too.
-- Lock only the tool_accounts row (FOR UPDATE OF a). Logic is otherwise unchanged.
CREATE OR REPLACE FUNCTION public.assign_tool_account_for_order(_order_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    FOR UPDATE OF a SKIP LOCKED;

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
$function$;
