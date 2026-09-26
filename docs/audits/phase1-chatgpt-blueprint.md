# Phase 1 — ChatGPT Blueprint & Foundation Audit

Date: 2026-09-26

## Scope

This phase is read-only architecture/audit work plus this documentation file.
No ChatGPT runtime, session vault, proxy route, database migration, or production deployment is introduced in Phase 1.

The audit compares:

1. the live Topratedseotools application,
2. the recovered AWS one-click source,
3. the working StealthWriter implementation,
4. the current ChatGPT tool configuration,
5. OpenAI's current supported multi-user access model.

## Current live ChatGPT state

The live `tool_settings` row for `chatgpt` is:

- enabled: true
- access_level: purchased
- one_click_auth_enabled: true
- official_login_url: https://chatgpt.com
- auth_provider: self_hosted
- launch_mode: new_tab
- display_manual_credentials: false
- shared_access_enabled: true
- private_access_enabled: true

Pricing currently includes a shared monthly ChatGPT option at NGN 8,500.

The static catalogue already contains `chatgpt`, but its catalogue domain is `openai.com`.
Phase 2+ should normalize the canonical ChatGPT launch target around `https://chatgpt.com`.

There is one legacy `tool_accounts` row for ChatGPT:

- label: Self Hosted Test
- access type: shared
- status: working
- enabled: true
- max capacity: 10
- active assignments: 0
- active saved sessions: 0

This row has no active dependency and does not need to be preserved as an active session source.

## Legacy one-click finding

ChatGPT currently falls into the generic `startSessionOnlyOneClickAuth` path because it has no dedicated ChatGPT launcher.

The persisted `auth_provider = self_hosted` value is no longer a usable provider.

`browser-provider-policy.ts` explicitly retires the self-hosted runtime and resolves unsupported persisted values to the current managed provider. With the current live global setting, this means ChatGPT would fall back to Browser Use.

Current live global browser-auth settings:

- enabled: true
- default_provider: browser_use
- session timeout: 30 minutes

That legacy path must not be treated as the new ChatGPT architecture.

Additional legacy defect:

`shared-session-launch.server.ts` currently contains Phrasly-specific writer error messages even though it is a generic launcher. A ChatGPT launch through that path would therefore surface the wrong tool name.

## Recovered AWS blueprint

The recovered AWS one-click engine provides a tool-agnostic architecture:

1. Toprated authenticates the customer.
2. Toprated verifies active tool access.
3. A short-lived signed handoff is issued.
4. The handoff is exchanged for a server-controlled access session.
5. Every protected request is re-authorized against the customer's source access.
6. The upstream/tool-specific layer is isolated from customer credentials.
7. Sensitive upstream state is never intentionally exposed to the customer.
8. Navigation and account-management paths can be restricted.
9. Usage/device policy is enforced server-side.
10. Session/audit rows remain server-only.

The recovered AWS source seeded only StealthWriter as an instant-engine example. ChatGPT appears only in the product catalogue and was not implemented as an AWS one-click engine.

Therefore there is no recovered ChatGPT cookie/session recipe to copy.

## Working StealthWriter blueprint to reuse

The following StealthWriter pieces are the proven implementation reference:

### Access and launch

- `src/lib/tool-launcher.ts`
- `src/lib/stealthwriter-proxy.functions.ts`
- `src/lib/stealthwriter-proxy.server.ts`

Reusable concepts:

- purchased order or active grant as the access source,
- 60-second one-time handoff,
- hashed handoff token in the database,
- exchange into a different HttpOnly proxy/session token,
- re-check source access after handoff,
- tool usage audit row,
- fail closed when the upstream source is unavailable.

### Admin-only secret handling

- `src/lib/stealthwriter-session.server.ts`
- `src/lib/stealthwriter-session.functions.ts`
- `src/routes/admin.tools.$slug.tsx`

Reusable concepts:

- admin/super-admin separation,
- metadata-only status responses,
- encrypted server-only state,
- no secret read-back to browser UI,
- admin audit entries that never contain secret values.

### Database security

- `tool_authorized_sessions` uses RLS,
- anon/authenticated roles have no access,
- only service_role can read/write protected state,
- proxy session tables are also server-only.

The current `tool_authorized_sessions` check constraint supports only:

- stealthwriter
- phrasly

A future ChatGPT integration must not silently write to this table without an explicit migration and an approved reason.

### AWS parity/hardening

Reusable patterns:

- device identity and limits,
- server-side allowed navigation policy,
- blocked account/billing/security paths,
- usage counters,
- first-party host allowlists,
- redirect validation,
- request-size limits,
- secure cookie attributes,
- safe diagnostics with no response bodies or secrets,
- optional dedicated proxy origin,
- immutable deployment releases and rollback.

## ChatGPT-specific access constraint

OpenAI's current Account Sharing Policy says an OpenAI account is intended for the individual who created it and that another person should use their own account.

Reference:
https://help.openai.com/en/articles/10471989-openai-account-sharing-policy

OpenAI's business terms likewise prohibit sharing individual login credentials between multiple users.

Reference:
https://openai.com/policies/services-agreement/

Because the intended Toprated audience is multiple writers, the StealthWriter pattern must **not** be copied at the "one hidden personal master ChatGPT login for many writers" layer.

This is a product-access constraint, not a technical accusation about the project.

## Supported real-ChatGPT-interface architecture

The closest supported architecture to the requested StealthWriter user experience is a ChatGPT Business workspace with an individual ChatGPT identity/seat per writer.

ChatGPT Business is OpenAI's multi-user workspace product.

Reference:
https://help.openai.com/en/articles/8792828-chatgpt-business-overview

ChatGPT Business supports SAML and OIDC SSO.

Reference:
https://help.openai.com/en/articles/11489188-setting-up-single-sign-on-sso-for-chatgpt-business

### Target experience

Toprated writer
→ clicks Launch ChatGPT
→ Toprated verifies order/grant/device policy
→ Toprated issues a short-lived launch handoff
→ writer is sent to the organization's real ChatGPT Business workspace
→ SSO/individual OpenAI identity handles ChatGPT authentication
→ writer uses the real ChatGPT interface
→ no shared master ChatGPT credential/session is exposed or reused

This preserves the key UX goal: the user lands in real ChatGPT rather than a rebuilt Toprated chat UI.

## Revised five-phase implementation map

### Phase 1 — Blueprint & foundation audit

Status: this document.

Deliverables:

- current ChatGPT state mapped,
- legacy path identified,
- AWS/StealthWriter reusable layers identified,
- OpenAI-supported multi-user access requirement identified,
- no runtime changes.

### Phase 2 — Admin workspace/SSO configuration

Instead of a personal ChatGPT session-cookie vault:

- add a ChatGPT-specific Admin configuration area,
- store only the organization's approved workspace/SSO configuration and non-secret metadata needed by Toprated,
- keep any server secret/config encrypted and server-only if the chosen identity-provider flow requires one,
- remove ChatGPT from the generic retired `self_hosted` provider path,
- add ChatGPT-specific status tests.

No writer launch is enabled until the configuration is valid.

### Phase 3 — One-click ChatGPT launch

Implement a dedicated ChatGPT launcher:

- verify Toprated access,
- verify assigned ChatGPT workspace identity/seat state,
- issue a 60-second one-time launch handoff,
- exchange/redirect through the approved workspace/SSO entry point,
- open real `chatgpt.com` in a new tab,
- never expose another user's credentials,
- never fall back to Browser Use/Cloudflare/self-hosted runtime.

The exact SSO target/parameters must come from the real ChatGPT Business workspace configuration.

### Phase 4 — AWS-parity access controls and hardening

Apply the AWS/StealthWriter control model around the launch:

- active order/grant re-check,
- device policy where desired,
- writer-to-workspace-identity mapping,
- seat/assignment status,
- rate-limited launch attempts,
- audit events,
- fail-closed behavior,
- safe diagnostics,
- no cross-tool state sharing.

ChatGPT itself remains responsible for its own in-product account, billing, security, and conversation permissions.

### Phase 5 — Live validation and deployment

Validate:

- active writer launches,
- inactive writer rejection,
- Business workspace membership,
- SSO sign-in,
- real ChatGPT interface,
- new tab launch,
- revoked seat/access behavior,
- expired order/grant behavior,
- multiple writers with separate identities,
- no legacy Browser Use launch,
- no shared master ChatGPT credentials,
- CI/typecheck/build,
- immutable production deployment,
- rollback.

## Planned code boundaries

Likely new ChatGPT-specific modules:

- `src/lib/chatgpt-launch.functions.ts`
- `src/lib/chatgpt-launch.server.ts`
- `src/lib/chatgpt-config.functions.ts`
- `src/lib/chatgpt-config.server.ts`
- `src/lib/chatgpt-policy.ts`
- ChatGPT-specific tests under `tests/`

Likely existing files to modify:

- `src/lib/tool-launcher.ts`
- `src/routes/admin.tools.$slug.tsx`

Possible migration:

- a dedicated server-only ChatGPT workspace/config table,
- a writer-to-ChatGPT-workspace-identity/seat mapping table if required by the selected SSO design,
- a ChatGPT launch-session/audit table if the handoff requires persisted one-time state.

Files that should remain untouched unless a regression test requires a shared helper change:

- StealthWriter proxy/session implementation,
- Phrasly proxy/session implementation,
- retired self-hosted runtime,
- Browser Use/Cloudflare launcher implementations.

## Phase 1 acceptance criteria

Phase 1 passes only if:

- no production runtime behavior changes,
- no database DDL runs,
- no ChatGPT secret/session is created,
- no StealthWriter/Phrasly file is modified,
- the legacy ChatGPT path is understood,
- the implementation boundary is documented,
- the next phase has a clear supported target.

## Audit result

PASS.

Phase 1 establishes that the Toprated access-control and handoff blueprint can be reused, while the shared personal-account session layer cannot be used for a multi-writer ChatGPT deployment.

No Phase 2 work should begin until this blueprint is explicitly approved.
