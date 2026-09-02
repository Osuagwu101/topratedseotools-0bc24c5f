-- Shared-auth hardening: admin refresh + writer session rejection audit events.
ALTER TABLE public.browser_auth_otp_audit
  DROP CONSTRAINT IF EXISTS browser_auth_otp_audit_event_check;
ALTER TABLE public.browser_auth_otp_audit
  ADD CONSTRAINT browser_auth_otp_audit_event_check
  CHECK (event IN (
    'otp_detected','otp_submitted','otp_accepted','otp_rejected','otp_timeout',
    'session_expired_on_reuse','admin_refresh_started','admin_refresh_otp_required',
    'admin_refresh_succeeded','shared_session_rejected','shared_session_expired'
  ));

COMMENT ON COLUMN public.tool_account_sessions.session_tokens IS
  'Reusable non-cookie browser storage state, including localStorage/sessionStorage when captured.';
