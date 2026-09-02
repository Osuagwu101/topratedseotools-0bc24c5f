# Roadmap — Phrasly shared-auth (session-only writer launch)

## Findings from inspection (current main)

- `src/lib/browser-auth.functions.ts` → `startOneClickAuth` is the writer/customer launch path.
  It loads `tool_account_sessions` (filtered `verification_status = 'active'`), maps cookies with
  `.slice(0, 10)` keeping only `{name, value}`, then **always** calls `launchBrowserUse` /
  `launchCloudflare` with `username`/`password`. If the saved session is missing or rejected,
  the same call silently falls through to full credential login + OTP detection and returns
  `status: "awaiting_otp"` with `otp_type` to the caller. This is the core violation of
  requirements 1, 2, 3, 8 and 10.
- `src/lib/browser-auth.server.ts` → `injectLogin()` injects cookies via `Network.setCookie`
  rebuilt against `new URL(loginUrl).hostname`, `path: "/"`, `secure: true`, `httpOnly: false`,
  losing original cookie attributes (requirement 7). No `sessionOnly` mode exists (requirement 8).
  No `localStorage`/`sessionStorage` reinjection.
- `src/lib/browser-auth-otp.server.ts` → `captureSessionStateThroughCdp()` caps cookies at
  `.slice(0, 20)` and stores an effectively empty `session_tokens` (`{captured_at}` only) and
  empty `auth_headers` (requirement 7).
- `src/lib/browser-auth-otp.functions.ts` → OTP submit is admin-role gated (good, requirement 6),
  writes `tool_account_sessions` with a 30-day TTL, resolves `account_id` from `otp_context` or the
  order assignment. Needs to also work for an admin-initiated refresh session that has **no order**.
- Each launch already creates a brand-new provider browser (`POST /browsers`, or a new Cloudflare
  devtools browser), so requirement 4 (3 concurrent, no account-level lock) holds today; only the
  per-user throttle (3 per 5 min on `browser_auth_sessions`) applies — keep it.
- `src/components/admin/AccountsCapacityTab.tsx` already renders `<AdminOtpQueue toolSlug={slug} />`
  at the top of the tab (requirement 6 partially satisfied); it has **no** "Authenticate / Refresh
  session" action per account (requirement 5).

## Tasks

- [ ] Migration: extend `tool_account_sessions` for reauth state (`invalidated_at`,
      `invalidated_reason`, `last_error_at`) + allow `verification_status = 'reauth_required'`;
      allow `browser_auth_sessions.order_id` NULL for admin refresh runs and add
      `purpose` (`customer_launch` | `admin_refresh`) + `account_id`. Non-destructive only.
- [ ] `browser-auth.server.ts`: add `sessionOnly` launch mode — inject full cookie set with original
      attributes + storage replay, validate auth, and throw a typed `ReauthRequiredError` **before**
      `loginInjectionExpression` is reachable.
- [ ] `browser-auth-otp.server.ts`: capture all relevant cookies (no slice cap), full attributes,
      plus `localStorage`/`sessionStorage` auth material into `session_tokens`.
- [ ] `browser-auth.functions.ts`: `startOneClickAuth` becomes session-only for account-backed tools;
      generic writer-safe error; mark the saved session `reauth_required` on upstream rejection;
      never return `otp_type`/selector/page text to writers.
- [ ] Grant flow (`src/lib/grant-access.functions.ts` / `access.functions.ts`) must use the same
      session-only path (requirement 9).
- [ ] New admin-only server fn `adminStartAccountAuthRefresh` (credential login + OTP allowed),
      wired into `AccountsCapacityTab` per-account "Authenticate / Refresh session" button.
- [ ] Writer UI: `ToolAccessPanel` / `tool-launcher` must not open the OTP modal on
      `reauth_required`; show only the generic temporary-unavailable message.
- [ ] Audit events: `admin_refresh_started`, `admin_refresh_otp_required`, `admin_refresh_succeeded`,
      `shared_session_rejected`, `shared_session_expired` in `browser_auth_otp_audit`.
- [ ] Tests for session-only enforcement + cookie fidelity; `bunx tsgo --noEmit`; `bun run build`.
