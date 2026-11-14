# Claude native proxy parity — 13 November 2026

Claude's existing native proxy now uses the request and session handling pattern
from the working StealthWriter and ChatGPT server proxies. This candidate has no
browser viewer or extension dependency.

## Changes
- Forward the incoming client's allowlisted application/request headers.
- Reconstruct Referer paths on the fixed claude.ai origin, dropping fragments
  and refusing TopRated launch-ticket or foreign-origin referrers.
- Save rotations of already authorised Claude application cookies back into
  the encrypted Claude-only vault, with an original-value condition to avoid
  overwriting a later Admin session replacement.
- Keep old and newly rotated credentials out of proxied response bodies.
- Never expose upstream Set-Cookie values or TopRated bearer/cookie credentials.
- Existing access checks, ticket handling and route permissions are retained.
- No changes to StealthWriter, ChatGPT, schema, balances or customer grants.

## Verification
Application build succeeded. TypeScript and Bun suites cover header forwarding,
Referer reconstruction, credential boundaries, cookie scope/expiry, encrypted
persistence, write-failure handling, rotated-secret guards and original Claude
permissions/streaming. These local/mock checks do not prove provider acceptance.

The live authorised-session probe using the new request builder returned:
{"ok":false,"code":"CL-02","message":"Claude requires browser verification from this server. OneClick remains disabled."}

The native writer journey is therefore NOT verified. Production remains on its
previous native configuration with CLAUDE_PROXY_VERIFIED=false. This candidate
has not been deployed or enabled for writers. The rejected browser-viewer
fallback remains disabled, with its verified rollback snapshot preserved.

Run the diagnostic with the server environment loaded:
  bun scripts/claude-native-parity/live-probe.ts

This diagnostic reports metadata only. It does not print Claude session values.
