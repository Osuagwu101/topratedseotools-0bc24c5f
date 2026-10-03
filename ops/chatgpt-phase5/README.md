# ChatGPT Phase 5 — single-account connection layer

Phase 5 follows the working StealthWriter behavior with one ChatGPT account only.

Flow:

TopRated entitlement/grant → Phase 3 one-time ticket → isolated gateway session → Phase 4 fixed-host transport → single encrypted ChatGPT session source → ChatGPT upstream.

## Single-account rule

There is no Account 1 / Account 2 abstraction in this phase. The gateway requires exactly one enabled, working ChatGPT row in `tool_accounts`, and the Phase 3 entitlement must point to that exact account.

The existing server-only `tool_authorized_sessions` row remains the single authentication source.

## Session format

The Phase 5 format is `chatgpt_minimal_cookie_json_v3`.

It stores only validated first-party ChatGPT/OpenAI cookie objects. Browser localStorage/sessionStorage is not part of v3. Analytics/support cookies and Cloudflare challenge state are discarded. Cookie values are treated as opaque and preserved exactly.

The gateway can decrypt the historical v2 envelope and normalise it to v3 on first valid use, then re-encrypt the same vault row. Only already-approved cookie names can rotate; new upstream cookie names are ignored.

## Writer isolation

Writers receive only TopRated gateway/device cookies. Upstream ChatGPT `Set-Cookie` values are never forwarded to the writer. Phase 3 continues to enforce entitlement, device binding, ticket replay protection, and writer isolation.

## Live deployment

The adapter is deployed only to the dedicated ChatGPT process on port 3006. StealthWriter on port 3000 and the main site on port 3005 were not restarted.

A normal eligible writer launch is still required for final real-upstream acceptance. The automated environment cannot consume the protected temporary gateway cookie fixture, so no attempt was made to bypass that boundary.
