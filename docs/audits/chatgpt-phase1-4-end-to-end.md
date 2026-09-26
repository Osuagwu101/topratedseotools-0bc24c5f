# ChatGPT Phase 1–4 End-to-End Audit

Date: 2026-09-26

## Scope

This audit validates the ChatGPT integration from Phase 1 through Phase 4 against:

- the recovered AWS one-click blueprint,
- the working StealthWriter server-side proxy model,
- the merged ChatGPT Phase 2 vault,
- the merged ChatGPT Phase 3 proxy,
- the Phase 4 hardening branch,
- the live Supabase schema/security state,
- the full repository CI regression suite.

VPS deployment and real upstream ChatGPT-session validation remain intentionally deferred to Phase 5.

## Architecture under audit

Toprated authenticated writer
→ active ChatGPT order/grant check
→ per-user ChatGPT status/rate/device checks
→ 60-second one-time handoff ticket
→ HttpOnly Toprated ChatGPT proxy session
→ server-side encrypted authorised ChatGPT session
→ fixed-host request to chatgpt.com / approved oaistatic hosts
→ real ChatGPT web response through the Toprated proxy.

The upstream ChatGPT session state remains server-side and is never returned to the writer.

## Phase 1 — Blueprint/foundation

### Result: PASS

Confirmed:

- ChatGPT already exists in the Toprated catalogue/tool settings.
- The old persisted self-hosted/browser-provider path is not used by the dedicated implementation.
- The recovered AWS source provides the reusable access-gate/handoff/server-session blueprint.
- StealthWriter provides the proven fixed-host proxy/security reference.
- ChatGPT uses its own namespace and does not share proxy/session state with StealthWriter or Phrasly.

### Historical blueprint note

The original Phase 1 planning document contains an SSO/workspace direction that was subsequently superseded by the explicitly approved Phase 2 session-vault model.

The implementation audited here follows the later approved architecture:

Admin authorised session
→ encrypted server-only vault
→ dedicated Toprated handoff/proxy
→ writer never receives upstream session secrets.

The Phase 1 AWS security principles remain applicable and are preserved.

## Phase 2 — Authorised-session vault

### Result: PASS

Implemented:

- `src/lib/chatgpt-session.server.ts`
- `src/lib/chatgpt-session.functions.ts`
- Admin ChatGPT “Authorised session” tab
- `20260926045500_chatgpt_session_vault.sql`

Validated:

- AES-256-GCM encryption at rest.
- ChatGPT/OpenAI first-party domain validation.
- analytics/support cookies are discarded.
- Cloudflare challenge cookies such as `cf_clearance` / `__cf_bm` are discarded.
- decrypted session state is never returned by the Admin API.
- Admin status is metadata-only.
- save/replace/revoke operations are audited without secret values.
- replacing/revoking the authorised session now revokes issued/active ChatGPT proxy sessions.

Live database state:

- `tool_authorized_sessions` has RLS enabled.
- `anon`: no SELECT.
- `authenticated`: no SELECT.
- `service_role`: SELECT allowed.
- no ChatGPT authorised-session row currently exists, which is expected before Phase 5.

## Phase 3 — One-click proxy

### Result: PASS

Implemented:

- `src/lib/chatgpt-proxy.functions.ts`
- `src/lib/chatgpt-proxy.server.ts`
- `src/lib/chatgpt-proxy-bootstrap.server.ts`
- dedicated server-entry interception
- dedicated ChatGPT launcher path
- `20260926062000_chatgpt_proxy_sessions.sql`

Validated:

- active order/grant required before launch.
- Admin vault must contain a stored session before a launch ticket can be issued.
- handoff ticket lifetime: 60 seconds.
- ticket is hashed before database storage.
- one-time ticket exchange changes the row into a different active proxy token.
- writer proxy token is HttpOnly + Secure + SameSite=Lax.
- source order/grant is rechecked after ticket exchange and on active requests.
- upstream is pinned to `https://chatgpt.com`.
- approved static-host routing is limited to ChatGPT/oaistatic hosts.
- launch ticket query parameter is never forwarded upstream.
- unrelated external redirects fail closed.
- write requests reject cross-site origins.
- request-size limit is enforced.
- ChatGPT event-stream responses are forwarded as streams instead of being buffered.
- binary responses are streamed.
- upstream Set-Cookie values are never returned to writers.
- cookie rotation can update only cookie names already approved in the encrypted vault.
- diagnostics contain only safe outcome/status metadata.
- Cloudflare `cf-mitigated: challenge` is classified but not bypassed.

Live database state:

- `chatgpt_proxy_sessions` has RLS enabled.
- `anon`: no SELECT.
- `authenticated`: no SELECT.
- `service_role`: SELECT allowed.
- current row count: 0 before Phase 5.

## Phase 4 — AWS-parity controls/hardening

### Result: PASS

Implemented:

- `src/lib/chatgpt-controls.server.ts`
- `src/lib/chatgpt-controls.functions.ts`
- ChatGPT customer controls on the Admin customer page
- stable app-device preparation endpoint
- stable proxy-device cookie
- device binding on proxy sessions
- launch-rate limiting
- blocked account/settings/billing document routes
- `20260926082000_chatgpt_phase4_controls.sql`

Validated:

- default ChatGPT device limit: 2.
- Admin can set a per-user device limit from 1–10.
- device fingerprints must be 32-character lowercase hex.
- a new device beyond the configured limit suspends ChatGPT access only.
- ChatGPT suspension does not suspend unrelated Toprated tools.
- active proxy requests require the bound device cookie.
- the bound device must still exist in `chatgpt_devices`.
- per-user ChatGPT status is rechecked on active requests.
- expired/revoked order/grant still revokes access independently of device state.
- Admin can suspend/reactivate ChatGPT access.
- Admin can clear registered ChatGPT devices and reactivate access.
- launch attempts are rate-limited; default 8/minute, configurable within a bounded 2–30 range.
- document navigation to auth/login/logout/account/billing/subscription/settings/admin prefixes is blocked server-side.
- normal ChatGPT document routes and JSON API requests are not broadly blocked by that policy.
- replacing/revoking the master authorised session invalidates existing proxy sessions.

Live database state:

- `chatgpt_user_controls` has RLS enabled.
- `chatgpt_devices` has RLS enabled.
- `anon`: no SELECT on either table.
- `authenticated`: no SELECT on either table.
- `service_role`: SELECT allowed.
- `chatgpt_proxy_sessions.device_fingerprint` exists.
- current control/device row counts: 0 before Phase 5.

The Supabase advisor reports these server-only tables as “RLS enabled with no policy.” That is intentional: direct anon/authenticated access is revoked and server operations use the service role.

## Cross-tool isolation

### Result: PASS

Phase 4 diff audit confirms no StealthWriter or Phrasly runtime file was modified.

The ChatGPT implementation has:

- its own encrypted vault key namespace,
- its own proxy cookie namespace,
- its own proxy-session table,
- its own device cookie namespace,
- its own controls/devices tables,
- its own launcher/server routes.

No Browser Use, Cloudflare Browser Run, or retired self-hosted runtime is used by the dedicated ChatGPT proxy path.

## Automated end-to-end source conformance

### Result: PASS

`tests/chatgpt-phase1-4-conformance.test.ts` validates the complete chain:

1. Phase 1 AWS blueprint exists.
2. Phase 2 encrypted/write-only vault exists.
3. Phase 3 60-second handoff and fixed-host streaming proxy exist.
4. Phase 4 device/rate/navigation controls are enforced in the live proxy source.
5. legacy browser-provider runtime is not part of the dedicated ChatGPT path.

`tests/chatgpt-phase4-validation.test.ts` validates Phase 4 policy behavior and source wiring.

## Regression status

Latest Phase 4 PR CI passed:

- SneakWrite SSO regression
- all Phrasly proxy/vault tests
- ChatGPT Phase 2 vault tests
- ChatGPT Phase 2 foundation checks
- ChatGPT Phase 3 proxy tests
- ChatGPT Phase 4 hardening tests
- ChatGPT Phase 1–4 conformance audit
- all StealthWriter Phase 2/3/4/5 and multi-account tests
- custom-payment gateway regressions
- TypeScript `tsc --noEmit`
- production build

## Deferred Phase 5 gates

The following are deliberately **not claimed as validated yet** because the real authorised ChatGPT session has not been added and the VPS deployment is deferred:

- authenticated upstream ChatGPT homepage rendering,
- real conversation-history loading,
- creating/sending a normal prompt,
- token-by-token live upstream response behavior,
- discovery of any additional first-party asset/API hosts required by the live ChatGPT build,
- real upstream cookie rotation,
- behavior if ChatGPT presents an edge/browser challenge,
- final production PM2/Nginx health after deployment,
- rollback verification.

These are Phase 5 acceptance tests.

## Final Phase 1–4 audit result

**PASS — architecture, code, database security, hardening, regressions, typecheck, and production build.**

Phase 1–4 are internally consistent and ready for Phase 5.

Phase 5 must begin by:

1. deploying the merged Phase 2–4 release,
2. adding the authorised ChatGPT session through Admin,
3. running live end-to-end upstream validation,
4. applying any host/path compatibility adjustments discovered from the real ChatGPT session,
5. completing final production/rollback validation.
