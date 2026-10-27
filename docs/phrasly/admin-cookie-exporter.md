# Osuagwu Solomon TopRated — Phrasly Admin cookie exporter

The supplied Jawad Ahmed EXR extension reads the active page's cookies and copies a complete Chrome cookie JSON array. It has no upload connection. This adaptation retains full JSON copying, uses the existing TopRated logo and requested name, and adds a first-party Admin handoff.

## Admin workflow

Install the ZIP's unpacked folder. On a signed-in phrasly.ai tab, open Osuagwu Solomon TopRated and choose Copy Cookies as JSON or Send to TopRated Admin. Sending opens /admin/phrasly in the same browser/profile. The account owner signs in if needed, chooses an account explicitly, then clicks Save imported account session. The existing server endpoint verifies owner authorization and stores the session encrypted. Label, capacity and enabled status come from the chosen account and are retained.

The exporter is separate from the writers' existing Phrasly Access extension. Its manifest identity is eohjplbcofclaeblcbdaoijfcdjpmmnl; the website receiver and deterministic packager verify the same identity. Its permissions cover Phrasly cookies, not all websites.

## Handoff

Sending is explicit. An unclaimed handoff is valid for five minutes; an expiry alarm removes abandoned packets, and every claim also checks its expiry. The URL contains only a random 256-bit nonce. A claim must come from the exact HTTPS TopRated Admin path, matching fragment and browser tab opened by the exporter. The packet is consumed before the response, serialized against concurrent requests and removed on expiry. Cookies are not placed in a URL, logs, local/sync extension storage or a remote third-party service.

The Admin page requests the packet only after /ext-admin confirms the signed-in owner. Imported values stay hidden in page memory. The account selector starts empty and Save stays disabled until an account is chosen. Saving uses the existing save_account action; no new database tables, role grants or public save API are introduced.

## Validation

27 executable worker/core checks cover source/domain limits, metadata preservation, session requirements, popup caller validation, trusted origin/path/tab/nonce binding, expiry, one-time consumption and concurrency. Nine real Chromium MV3 fixture checks cover full JSON copy, login before claim, hidden values, required account selection, settings preservation, saved payload equality, replay rejection, package bytes and non-owner/other-page denial. Fixtures use synthetic cookies/accounts and block external network access.

Run npm ci --prefix tests/phrasly-admin-exporter, build the workspace assets, then npm test --prefix tests/phrasly-admin-exporter. The dedicated GitHub workflow runs the tests in headed Chromium under Xvfb. The packaging check detects a stale ZIP or receiver/manifest identity mismatch.

## Package

public/phrasly-assets/Osuagwu-Solomon-TopRated.zip
Version: 1.0.0
SHA-256: 84116055b20c1afc8f3a87a968095c6579730d6f96378bdd2449d975d7708eb7

Only public Admin JavaScript and this new download need activation. Existing writer assets, writer ZIP, backend, database and provider-processing behavior are retained. Activated on 27 October 2026 from source d6c352ddc4c812ef8461c97b505232ec99674f73. The deployed Admin asset is ec947e03d96182121ae44bbe354cd994959582436ecf7b4f65ac45d90f124b00; the ZIP SHA above matches the live browser download.

Live acceptance passed using a temporary owner session and the existing authenticated Phrasly account:
- The real extension captured the current browser session and handed it to the authenticated owner page.
- The target account had to be chosen explicitly. The real save request was guarded against a different target or changed metadata.
- The account-session update succeeded exactly once, preserving label, capacity and enabled state.
- The Admin download produced the exact packaged ZIP.
- A temporary writer login then opened ready native Humanizer and AI Detector editors after the account refresh.
- No provider processing was requested. The temporary owner and writer sessions were revoked locally, leaving existing user sessions intact.

The captured session differed from the stored snapshot at preparation time. This is recorded as an observation, not a failed acceptance check: Phrasly was authenticated before export, the saved session matched the captured browser session, and both native editors authenticated afterward.

The 62 application processes, all existing writer/public assets and the enabled writer ZIP remained unchanged. Orders, source access grants and Phrasly daily-usage fingerprints also remained unchanged. The guarded deployment keeps the previous Admin asset in /home/ubuntu/backups/phrasly-admin-exporter-20261027 for rollback.

Evidence: evidence/admin-exporter-live-20261027.json. CI at the deployed source passed exporter regression, frontend review, AWS parity and cross-service regression. The live test script requires explicitly prepared private acceptance inputs and is not part of ordinary CI.
