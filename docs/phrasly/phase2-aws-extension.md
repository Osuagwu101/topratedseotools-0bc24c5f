# Phase 2: authoritative AWS extension approach

Phase 2 selects and verifies the AWS implementation for the TopRated migration. The user's latest instruction to use exactly what AWS uses supersedes the earlier session-transfer exclusion. The restored cookie login, account assignment, popup and original request behavior are the implementation target. Phase 3 implements the live backend; Phase 4 connects the website and distributes the extension; Phase 5 verifies real end-to-end processing; Phase 6 releases it.

## Verified AWS flow

1. A signed-in page calls `ext-handoff.php?tool_id=...&feature=...`. It signs base64url JSON using HMAC-SHA256 hex with a 60-second expiry.
2. The page sends `trst_access`, `payload` and `signature` to the extension. The extension redeems them with GET `ext-fulfill.php`.
3. Fulfillment rechecks the user, subscription, feature grant and allowance. `oc_assign_cookie_account` reuses an existing assignment or chooses the earliest account with capacity. It returns that account's cookies, the feature URL, block paths and a four-hour record token. Opening does not increment usage.
4. The original worker attempts cookie installation before opening the native tab, tracks its record/cookie metadata, redirects blocked account paths, and the content script hides account controls.
5. The MAIN-world interceptor watches request URLs containing `/api/ai/rewrite` or `/api/ai/detect`. The isolated relay and worker call POST `ext-check-usage.php` with only `record_token` and `feature`.
6. The backend rechecks access and increments that feature's WAT-day attempt counter. Denial clears the tracked cookies and opens the countdown page.
7. The popup reads first-party `PHPSESSID` through `chrome.cookies`, sends `X-Ext-Session` to `ext-whoami.php`, displays identity/feature allowance, and uses the same launch path.

Tinyproxy is separate from this active extension path. Native browser requests go directly to Phrasly.

## Exact source and declared adaptations

[The canonical reference](https://github.com/Osuagwu101/topratedseotools.com.ng-source/blob/4c420f5d054653d4dc3eb12ecf74e0508556b184/reference/phrasly-oneclick/aws-canonical/README.md) in the private AWS source repository contains all 12 original extension files and its ZIP, 24 unchanged backend/template/image files, and 14 schema objects. [The provenance file](../../config/phrasly-aws-extension-provenance.json) reversibly describes the `.com` extension adaptations. Both verifiers fail on an unexplained byte change.

| Component | Status |
| --- | --- |
| Cookie installation/cleanup, account menu and navigation behavior | Original AWS bodies restored |
| Popup, icons, public manifest key/ID | Original AWS source restored |
| GET redemption, POST usage fields, timeout behavior | Original AWS contracts retained |
| Server signing helpers | AWS field order, expiry and acceptance semantics retained; TopRated UUIDs supported |
| Deployment origin and links | Changed to `https://topratedseotools.com` |
| Deployment switch and readiness probe | Explicit additions; disabled package excludes static content scripts |
| Website launcher helper | Existing wrapper probes readiness and dispatches the original message once |
| Allocator, tables, PHP endpoints and templates | Preserved unchanged in the canonical backend reference; rehearsed with disposable data |

The source public key retains extension ID `lpgnjkafilbopdojcfnagooojifkccek`. A manifest public key is not a private signing key.

## Behavior to carry into implementation

The original handoff is reusable until expiry. The same secret verifies both token forms, without a cryptographic purpose claim. The four-second native interceptor timeout allows the native request to continue. Its URL substring matching is method-agnostic. An enabled package denies intercepted actions in untracked tabs. Partial cookie-setting failures are reported but still open the tab. Closing a tab removes tracking without clearing the shared browser cookie jar. A processing failure still consumes a counted attempt. Account assignment uses count-then-insert without a capacity transaction. These are observed AWS behaviors, not guarantees of hardened concurrency, successful login or successful processing.

No single-use redemption, action deduplication, refund-on-failure, strict URL matcher or fail-closed timeout is claimed. Those earlier proposed changes are not silently substituted for the AWS implementation.

See the [backend handoff](phase2-backend-handoff.md), [reproduction guide](phase2-staging-guide.md) and [closeout](phase2-closeout.md). The live website has not been switched in this phase.
