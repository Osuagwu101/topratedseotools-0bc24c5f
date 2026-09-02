-- Add OTP/2FA support for authenticated browser sessions
-- Allows storing authenticated browser state to reuse across logins

-- 1. Add grant_id column to browser_auth_sessions for grant-based access tracking
ALTER TABLE public.browser_auth_sessions
  ADD COLUMN IF NOT EXISTS grant_id uuid REFERENCES public.tool_access_grants(id) ON DELETE SET NULL;

-- 2. Update status enum to include otp states
ALTER TABLE public.browser_auth_sessions
  DROP CONSTRAINT IF EXISTS browser_auth_sessions_status_check;

ALTER TABLE public.browser_auth_sessions
  ADD CONSTRAINT browser_auth_sessions_status_check
  CHECK (status IN ('starting', 'ready', 'failed', 'expired', 'closed', 'awaiting_otp', 'otp_submitted'));

-- 3. Add OTP context fields
ALTER TABLE public.browser_auth_sessions
  ADD COLUMN IF NOT EXISTS otp_context jsonb
    COMMENT 'Contains: {detected_type: "email"|"sms"|"authenticator", field_selector: "...", error: "...", attempt_count: 0}',
  ADD COLUMN IF NOT EXISTS otp_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS otp_submission_error text;

-- 4. Create table for authenticated browser sessions (cookies, tokens)
CREATE TABLE IF NOT EXISTS public.tool_account_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.tool_accounts(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('browser_use', 'cloudflare')),
  provider_session_id text,

  -- Captured authenticated state
  authenticated_cookies jsonb COMMENT 'Array of {name, value, domain, path, expires, secure, httpOnly}',
  session_tokens jsonb COMMENT '{accessToken?, refreshToken?, ...}',
  auth_headers jsonb COMMENT 'Common headers from authenticated requests',

  -- Verification & lifecycle
  last_verified_at timestamptz,
  verification_status text NOT NULL DEFAULT 'active'
    CHECK (verification_status IN ('active', 'expired', 'invalid')),
  expires_at timestamptz,

  -- Audit
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tool_account_sessions_account_idx
  ON public.tool_account_sessions(account_id, verification_status);
CREATE INDEX IF NOT EXISTS tool_account_sessions_provider_idx
  ON public.tool_account_sessions(provider, verification_status);

GRANT SELECT, INSERT, UPDATE ON public.tool_account_sessions TO authenticated;
GRANT ALL ON public.tool_account_sessions TO service_role;
ALTER TABLE public.tool_account_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tool_account_sessions admin all" ON public.tool_account_sessions
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'))
  WITH CHECK (has_role(auth.uid(),'admin') AND created_by = auth.uid());

-- Prevent users from querying other users' sessions
CREATE POLICY "tool_account_sessions deny select non-admin" ON public.tool_account_sessions
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin') OR created_by = auth.uid());

CREATE TRIGGER tool_account_sessions_touch BEFORE UPDATE ON public.tool_account_sessions
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- 5. Add audit table for OTP events
CREATE TABLE IF NOT EXISTS public.browser_auth_otp_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.browser_auth_sessions(id) ON DELETE CASCADE,
  account_id uuid REFERENCES public.tool_accounts(id) ON DELETE SET NULL,
  event text NOT NULL
    CHECK (event IN ('otp_detected', 'otp_submitted', 'otp_accepted', 'otp_rejected', 'otp_timeout')),
  otp_type text,
  error_message text,
  submitted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS browser_auth_otp_audit_session_idx
  ON public.browser_auth_otp_audit(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS browser_auth_otp_audit_account_idx
  ON public.browser_auth_otp_audit(account_id, created_at DESC);

GRANT SELECT, INSERT ON public.browser_auth_otp_audit TO authenticated;
GRANT ALL ON public.browser_auth_otp_audit TO service_role;
ALTER TABLE public.browser_auth_otp_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "otp_audit admin all" ON public.browser_auth_otp_audit
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'))
  WITH CHECK (has_role(auth.uid(),'admin'));
