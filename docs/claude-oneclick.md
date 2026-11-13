# Claude OneClick setup — gated draft

This implementation reuses Grammarly's architecture: an AES-GCM session vault,
authenticated launch function, 60-second single-use handoff, and a dedicated
proxy hostname with an HttpOnly local session cookie. Claude credentials stay
server-side. The server validates the writer's paid order or active grant on
requests, and checks conversation ownership before forwarding chat requests.

## Current status (13 November 2026)

Claude uses the Grammarly-style dedicated-host proxy at
`https://claude.topratedseotools.com`. The native extension experiment is retired:
writer and Admin issuance reject it, redemption returns 410, and its public ZIP
and setup prompts are removed. Existing native sessions already delivered to a
browser cannot be withdrawn by removing the extension flow.

DNS resolves to OVH. Provision the dedicated certificate and Nginx virtual host
with `sudo python3 scripts/claude/setup-proxy-host.py prepare`, deploy the app,
then run the script with `activate`. Nginx uses the main app's active blue/green
port with response buffering disabled; subsequent deployments already track this
host. The preparation step sets the server origin and keeps
`CLAUDE_PROXY_VERIFIED=false`.

A fresh authenticated VPS diagnostic using the saved authorised session still
returned `cf-mitigated: challenge` (CL-02). The prior native-browser success does
not establish reverse-proxy compatibility. Writer launch remains gated until
that upstream verification and live native UI tests pass. DNS/TLS and ticket
routing alone cannot resolve an upstream browser-verification challenge.
There is no extension fallback, challenge bypass, or official API substitute.

## Included

- Claude catalog entry, launch dispatch and dedicated-host server handler.
- Super Admin session save/replace/revoke and metadata-only diagnostic test.
- Separate encryption key derivation and required non-expired `sessionKey`.
- Service-role-only RLS tables for proxy sessions and conversation owners.
- History filtering, conversation checks, streaming responses and CSRF checks.
- Unknown API routes, account mutations, deletion, sharing, projects, integrations
  and file access fail closed. Uploads/artifacts are not supported in this draft.
- Embedded private-state detection rejects recognized SSR chat payloads, secret
  reflection and unknown history shapes. This guard is not a proof of complete
  native hydration isolation: real Claude payloads must be inspected and tested.

## Deployment prerequisites

1. Apply the included additive migration after review. Existing balances and
   tool sessions are not modified. Claude starts with both switches disabled.
2. Configure DNS/TLS for `claude.topratedseotools.com`. Its Nginx root proxy should
   follow the main app's live port (3270 or 3271). The deployment script recognizes
   `/etc/nginx/sites-enabled/claude-proxy` when present. Disable proxy buffering
   for streaming replies; use an appropriate long read timeout.
3. Set `CLAUDE_PROXY_PUBLIC_ORIGIN=https://claude.topratedseotools.com`.
   Optionally set a separate 32-byte `CLAUDE_SESSION_ENCRYPTION_KEY`; otherwise a
   Claude-specific HKDF key is derived from the existing service-role key.
4. Import an authorized first-party session in Admin → Claude → Authorised
   session. Never put real cookie values into source, logs or chat. Saving a
   session disables OneClick and revokes existing local launch sessions.
5. Run **Test session**. It checks authenticated `/api/organizations` and returns
   diagnostic metadata only; success does not enable writer launch.
6. Complete native UI validation in a restricted staging environment: load,
   create/send/stream, rename, reload, history and account restrictions. Use two
   distinct writers and check HTML, RSC hydration, list/search endpoints, guessed
   chat IDs, request-body references and concurrent ticket exchange. Update the
   route policy to observed endpoints without broad wildcard access.
7. Only after these checks pass set `CLAUDE_PROXY_VERIFIED=true` and explicitly
   enable Claude plus OneClick in tool settings. Both gates are required.

## Local validation

```sh
bun tests/claude-oneclick.test.ts
bun tests/grammarly-session-vault.test.ts
bun tests/grammarly-proxy.test.ts
bunx tsc --noEmit
bun run build
```

The Claude suite tests encrypted storage, malformed/expired cookies, route
restrictions, list filtering, foreign-writer requests rejected before upstream,
revocation, disabled configuration, CSRF and streaming using mocked services.
It does not establish real Claude browser compatibility or live database setup.
