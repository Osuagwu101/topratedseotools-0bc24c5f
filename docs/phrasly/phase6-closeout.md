# Phase 6 closeout — 26 October 2026

Status: COMPLETE. The AWS-style Phrasly workflow is deployed for the account owner and explicitly assigned in-house writers.

## Live access

- Writer workspace: https://topratedseotools.com/phrasly
- Owner administration: https://topratedseotools.com/admin/phrasly

The writer page uses the existing TopRated sign-in, shows feature-specific daily usage, launches the original AWS MV3 flow, and distributes the verified enabled extension ZIP through an authenticated POST. The owner page requires the existing active Super Admin role and an admin account; it assigns/revokes feature grants and refreshes the encrypted Phrasly cookie snapshot. It never displays saved cookie values.

No Phrasly product listing, checkout, subscription sale, customer financial record or unrelated service was added or changed. The existing three expired historical Phrasly grants were not revived. The account owner was explicitly enabled; the internal QA grant retains its original expiry. Other writers are assigned individually through the owner screen.

## Deployed artifact

- Runtime commit: a264d5fd9b18209e008ca015a86e7cdcad7becef.
- Release: /home/ubuntu/releases/trst-phrasly-aws-20261026.
- PM2: trst-phrasly-aws-oct26, loopback 127.0.0.1:3338, persisted with pm2 save.
- Archive SHA-256: acc15a9200b5e904b4f556095b75fa528fdd13d611e78a02fc8d8d58bf3be826.
- Extension SHA-256: 07fb62c132bca769a1b4adc5aec4731ba5f312abbe07b022ce5bb1cbd0f5f3b3.
- Stable AWS extension ID: lpgnjkafilbopdojcfnagooojifkccek.
- Packaged 655 runtime files; operational-secret scan passed; no native platform modules.
- Later documentation/acceptance commits do not change deployed runtime code.

Nginx forwards only the private workspace/Admin pages, the eight Phrasly extension/status/admin/package endpoints, and /phrasly-assets/ to the release. Existing storefront, login, Admin, payment and unrelated tool routes remain on their original services. The retired /api/phrasly-proxy remains HTTP 410. New capability-bearing endpoints do not write access logs. Private pages are no-index and have a self-origin content security policy.

## Verification

All CI checks on the deployed runtime commit passed:
- AWS extension parity: run 40303138990.
- Frontend/actual Chromium launch: run 40303138961.
- Cross-service regression and full build: run 40303138954.

Release API acceptance: 11/11 passed locally and again against https://topratedseotools.com at 11:06 WAT. Coverage includes signed-out rejection, writer/Admin separation, active owner authorization, grants/allowance restoration, revocation, input validation, foreign-cookie rejection, exact encrypted AWS cookie preservation, exact enabled package download, page/assets and no-index/CSP headers.

Public HTTPS Chromium acceptance at 11:07 WAT passed seven checks: signed-out sign-in page, assigned writer controls, exact ZIP download, authenticated native Humanizer page, authenticated native AI Detector page, popup identity/features and owner Admin controls. No first-party page errors occurred. These checks opened the real native editors without additional generation. Successful 50-word real rewriting and the finished detector score were already proven in Phase 5.

The public site smoke comparison preserved status AND response byte count for home/login/Admin, StealthWriter, ChatGPT, Turnitin and Turnitin buy. The original 60 PM2 process PIDs/status/restart counters were unchanged. Final monitoring confirmed the added release online with zero restarts, protected runtime settings, persisted PM2 configuration, and no operational secrets in its release logs. Supabase advisor warning categories/counts were unchanged.

## Rollback

The effective file is /etc/nginx/sites-enabled/topratedseotools. The protected pre-release snapshot and PM2 inventory are in /home/ubuntu/backups/phrasly-phase6-live-20261026. Follow phase5-rollback.md; do not use the obsolete similarly named sites-available file.

An initial probe reached an old worker during graceful Nginx reload and triggered successful automatic rollback. The retry recorded [404,200] during warmup, then passed every strict new-route and ordinary-route check. The old unmanaged candidate on port 3336 was stopped after activation.

## Provider allowance and operator workflow

The native provider account showed Free plan and 11 words left during the public browser check. This is the provider's account allowance, independent of TopRated's daily request-attempt allowances. It is not unlimited. For continued Humanizer use, the owner can replace the Phrasly cookie snapshot in the owner screen with an authorized account session that has sufficient allowance.

To add a writer: use an existing TopRated account email in Phrasly Admin, set Humanizer/Detector daily request limits and optional expiry, and save. The writer signs in at /phrasly, downloads/extracts the extension, loads it using the documented Chrome/Edge steps, and launches a feature. No writer invitations or other messages were sent automatically.

The AWS request matching, language-check counting, native retries, attempt accounting and native session behavior were retained. No Business API, provider proxy or substitute processing service was introduced. No charges, refunds, balance changes or financial-table writes occurred.
