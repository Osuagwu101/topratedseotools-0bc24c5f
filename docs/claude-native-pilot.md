# Native Claude Admin pilot

Claude's website challenges the HTTP proxy even with a saved session. This pilot
uses an authorized Chrome extension to import only the stored application session
into the Admin's test profile and open the real https://claude.ai/new page.
There is no Claude official API, remote browser runtime, challenge automation,
proxy rotation, browser fingerprint modification or challenge-cookie transfer.

## Security and rollout boundary

The pilot is Super Admin only. Writer grants and subscriptions do not authorize
it. It is intentionally separate from writer launch and does not enable the
original proxy. A 60-second, 256-bit handoff ticket is hashed in its own RLS-locked
ledger and atomically consumed once. Redemption rechecks the Admin's active role,
vault status and vault update timestamp. Revoked/replaced sessions reject old
tickets. CORS accepts only the package's fixed extension origin. Cookies and
handoff values are never logged or returned to the TopRated web page.

The extension is a trusted cookie recipient, not a secret-hiding mechanism. The
session is present in Chrome and accessible to the browser's owner. It refuses
to replace a different existing session. A matching existing session is reported
as reused; a clean profile is required to verify an actual import. No content
scripts are injected into Claude and no history is filtered. Native shared-account
history is therefore NOT isolated. Do not release this handoff to writers until
the account/privacy model has been resolved. Separate Chrome profiles alone do
not separate the history stored on one Claude account.

## Manual acceptance

1. Apply the additive claude_native_admin_pilot migration and deploy the website.
2. In a separate Chrome profile, sign in to TopRated as Super Admin.
3. Download /downloads/toprated-claude-native-pilot.zip, extract it and use
   chrome://extensions → Developer mode → Load unpacked.
4. Refresh /admin/tools/claude, select Authorised session and click
   Test native Claude in Chrome. Any normal Claude verification must be completed
   by the Admin in the actual Claude tab.
5. Verify an imported (not reused) session reaches a signed-in Claude editor,
   accepts a short message, streams a reply and reopens it after refresh.
6. Report only the outcome. Never paste cookies, tickets or screenshots of their
   values into chat. If login is required, authentication has not been verified.
7. Remove Claude's cookies or delete the disposable profile after the trial.
   Removing the extension does not remove site cookies. Logging out of Claude
   can invalidate the shared session, so avoid it during this test.

Browser acceptance remains pending until the extension is installed and these
checks actually pass. Unit tests do not prove a real Claude launch.

## Validation

bun tests/claude-native-pilot.test.ts
bun tests/claude-oneclick.test.ts
bunx tsc --noEmit
bun run build
