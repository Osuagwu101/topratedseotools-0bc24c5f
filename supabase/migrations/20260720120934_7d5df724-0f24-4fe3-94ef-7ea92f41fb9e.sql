
-- Internal secrets table (service role only; RLS on with no policies).
CREATE TABLE IF NOT EXISTS public.internal_secrets (
  name text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.internal_secrets TO service_role;
REVOKE ALL ON public.internal_secrets FROM anon, authenticated;

ALTER TABLE public.internal_secrets ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies: only service_role (which bypasses RLS) can read/write.
