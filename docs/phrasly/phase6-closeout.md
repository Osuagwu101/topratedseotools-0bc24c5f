# Phase 6 closeout — actual customer flow verified

Status: DEPLOYED AND VERIFIED, including the customer-entry correction on 26 October 2026.

The earlier closeout covered the separate /phrasly route and missed the retained storefront's actual Launch Phrasly button and visible extension setup. The owner correctly identified that gap. The customer route, dashboard download panel and installation instructions are now integrated and tested on production.

## Customer workflow

1. Use the normal TopRated customer login.
2. Open /dashboard or /tools/phrasly. Both provide Download Extension and installation guidance.
3. Download the authenticated enabled ZIP and extract it.
4. Open chrome://extensions, edge://extensions or brave://extensions. Enable Developer mode, choose Load unpacked and select the extracted folder containing manifest.json.
5. Return to TopRated. The actual Launch Phrasly button opens the signed-in native Humanizer; Access AI Detector opens the signed-in native Detector.

The download automatically expands the numbered instructions. With the extension missing, Launch Phrasly shows installation help instead of opening Phrasly's login/signup page. Writers do not enter a separate provider password. Phrasly's own startup can take time, as it does on AWS.

Customer links:
- https://topratedseotools.com/dashboard
- https://topratedseotools.com/tools/phrasly
- https://topratedseotools.com/phrasly?setup=1 — installation guide
- https://topratedseotools.com/phrasly — automatic native Humanizer entry
- https://topratedseotools.com/phrasly?feature=ai_detector — automatic native Detector entry
- https://topratedseotools.com/admin/phrasly — separate owner controls

Processing remains entirely on native phrasly.ai. No first-party processing editor, cloned Phrasly dashboard, iframe, Business API or provider proxy was added.

## Deployment

- Customer frontend source: 822809e8483d5d2fcfa11a02b1aaf843a14f8adc.
- Public assets: /var/www/trst-phrasly-entry-20261026, seven files.
- Frontend archive SHA-256: e406f6dd86017146e3d801a97d0645fe2c6316e891b42466fc2a76e52c6bde4e.
- Activated: 21:05 WAT.
- Backend remains manifest source 70e5c9be8a2c9ea691b39c779cfac9abe07058a2 in /home/ubuntu/releases/trst-phrasly-native-20261026, PM2 trst-phrasly-native-oct26 on 127.0.0.1:3339.
- The original storefront remains on port 3124. Its bootstrap adds only Phrasly setup/launch behavior, including client-side navigation. Existing GA4 insertion is retained.
- Public Phrasly assets are served directly by Nginx; the existing eleven private page/API upstreams continue on port 3339.
- Enabled ZIP SHA-256 remains 07fb62c132bca769a1b4adc5aec4731ba5f312abbe07b022ce5bb1cbd0f5f3b3.
- Original extension ID remains lpgnjkafilbopdojcfnagooojifkccek.

The extension files and the enabled ZIP were not changed by this customer-entry correction. Public bundles were scanned for the exact operational secrets before installation; none were present.

## Verification

All three CI checks on customer frontend source 822809e passed: frontend/actual Chromium 40392150805, AWS parity 40392151114, cross-service regression 40392151073. The frontend build and JavaScript/Python syntax checks also passed.

The full public customer run, starting at 21:18 WAT, passed all eight checks:
- Actual customer password login writes the existing customer session storage.
- The real Launch Phrasly button with no extension shows setup, without opening a provider login tab.
- AWS-style installation instructions are visible.
- Download from the actual tool page matches the enabled ZIP byte for byte.
- The customer dashboard contains the download panel.
- Actual tool-catalog navigation displays the Phrasly setup panel.
- The real legacy Launch Phrasly button opens the authenticated native Humanizer editor.
- The actual tool page opens the authenticated native Detector editor.

No page errors occurred and no generation was requested. Native handoff and editor readiness allow three minutes each. The navigation test explicitly returns the customer tab to the foreground, matching user interaction.

The password-login check used the existing internal QA account. Native access checks used the existing owner with explicit writer grants. No expired QA or historical grant was revived.

Separate public support checks passed: owner controls render with the saved-cookie field empty; /phrasly?setup=1 shows the installation guide without auto-opening native tabs. These checks cover the changed shared frontend bundles as well as the normal customer flow.

Post-deployment monitoring at 21:11 WAT passed: original 60 process PIDs/status/restart counts unchanged, all 62 application processes unchanged during activation, native backend online with zero restarts, protected settings, persisted PM2 state, no operational secrets in its logs, seven exact public asset hashes, correct private endpoint authorization, and the retired proxy returning HTTP 410. Ordinary responses match after removing only the added bootstrap and observed per-request SSR timestamps.

Detailed machine-readable evidence: evidence/phase6-customer-entry-20261026.json. Tests: tests/phrasly-customer-entry.cjs and tests/phrasly-entry-support-ui.cjs.

## Operation and rollback

Assign writers through the existing owner page, with feature limits and optional expiry. Installation is once per browser/profile. Existing browser tabs need one refresh to load the new entry integration.

The provider account's allowance is independent of TopRated request limits. Its last measured allowance was Free plan, 11 words left, at 11:07 WAT; that amount was not remeasured during this correction. Continued processing requires sufficient provider allowance.

Latest routing backup: /home/ubuntu/backups/phrasly-entry-fix-20261026/nginx-before.conf. Restore only /etc/nginx/sites-enabled/topratedseotools, validate nginx -t, then reload and verify. No application restart or database rollback is required for this frontend correction. Detailed steps are in phase5-rollback.md.

No payments, balances, orders, financial tables, expired grants, daily counters, account cookies or original AWS processing behavior were changed. Opening native features remains free of request-count consumption; native processing attempts retain the original AWS accounting.
