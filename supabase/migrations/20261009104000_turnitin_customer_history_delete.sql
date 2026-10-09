-- Customer-controlled removal from Turnitin history.
-- Preserve immutable credit and postpaid financial references.
ALTER TABLE public.turnitin_jobs
  ADD COLUMN IF NOT EXISTS history_deleted_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS turnitin_jobs_visible_by_user_idx
  ON public.turnitin_jobs(user_id, created_at DESC)
  WHERE history_deleted_at IS NULL;

COMMENT ON COLUMN public.turnitin_jobs.history_deleted_at IS
  'Hidden from customer history after confirmed customer deletion; financial/audit ledger stays intact.';

-- Existing Turnitin job RLS remains owner-read-only for authenticated clients.
-- Only trusted server-side actions using service_role can set history_deleted_at.
