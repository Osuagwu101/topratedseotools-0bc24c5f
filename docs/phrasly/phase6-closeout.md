> Reopened for customer-entry correction. Earlier verification covered /phrasly, not the actual retained storefront Launch Phrasly path or visible dashboard installation. See customer-entry-correction.md.

# Phase 6 closeout — 26 October 2026

Status: COMPLETE AND DEPLOYED. Writers enter native Phrasly at phrasly.ai through the original AWS MV3 handoff. The additional TopRated writer dashboard has been removed from the writer flow.

## Live access

- Humanizer entry: https://topratedseotools.com/phrasly
- Detector entry: https://topratedseotools.com/phrasly?feature=ai_detector
- Owner administration: https://topratedseotools.com/admin/phrasly

An authorized signed-in writer with the extension is automatically sent into the native Phrasly tab. TopRated shows only the necessary sign-in, extension setup, transition or access-error state. There is no TopRated processing editor, recreated Phrasly dashboard or iframe. Native destinations are https://phrasly.ai/dashboard/humanizer and https://phrasly.ai/dashboard/ai-detector.

The separate owner page retains existing Super Admin authorization, individual writer grants/revocation, feature-specific daily limits and encrypted account-cookie updates. Saved cookie values are never returned to the owner UI. Opening a feature does not consume a request; original AWS attempt accounting applies to native processing requests.

## Deployed artifact

- Runtime manifest source: 70e5c9be8a2c9ea691b39c779cfac9abe07058a2.
- Native UX application change: 10568a7272ca9211c9d465a4bc45c07a45dbd255.
- Release: /home/ubuntu/releases/trst-phrasly-native-20261026.
- PM2: trst-phrasly-native-oct26 on 127.0.0.1:3339, persisted with pm2 save.
- Archive SHA-256: 45d85727ea82a9774782477470e3d0da80943ad8f70f7de2508bda10dc25ccf7.
- Enabled extension SHA-256: 07fb62c132bca769a1b4adc5aec4731ba5f312abbe07b022ce5bb1cbd0f5f3b3.
- Original stable extension ID: lpgnjkafilbopdojcfnagooojifkccek.
- 655 runtime files; operational-secret scan passed; zero native platform modules.
- Live switch: 18:51 WAT. The superseded Phrasly release on port 3338 is stopped and retained for rollback.

Only the existing twelve Phrasly upstream references changed from 3338 to 3339 inside the Phrasly Nginx block. The effective file is /etc/nginx/sites-enabled/topratedseotools. Original storefront, login, Admin, payment and unrelated tool routing remains unchanged. The retired provider proxy remains HTTP 410.

## Verification

All three CI workflows on runtime-manifest source 70e5c9b passed: frontend/Chromium 40371669102, AWS parity 40371669080, cross-service/full build 40371669014. The local production build also passed.

Fresh public HTTPS API acceptance at 19:39 WAT passed all eight checks: three signed-out rejections, explicit writer grants, sanitized owner state, exact enabled ZIP, and both private pages with no-index/CSP headers. No grant or financial mutation was needed for this final run.

Fresh visible Chromium acceptance started at 19:39 WAT and passed:
- Signed-out sign-in screen.
- Owner Admin controls, with the saved-cookie field empty.
- Automatic native Humanizer launch.
- Automatic native Detector launch.
- Absence of the extra writer dashboard and embedded iframe.
- Extension popup identity and both feature entries.
- Authenticated native Humanizer editor ready for input.
- Authenticated native Detector editor ready for input.

The acceptance actor was the existing owner with explicit writer grants. The temporary QA grant had already expired and was not revived. No page errors or provider generation requests occurred. Earlier native checks had remained on Phrasly's loading screen; the final fresh run loaded both real editors successfully. The owner confirms that the original AWS experience also commonly takes time to open. This expected startup delay must not be confused with a failed first-party handoff. The acceptance test now allows up to three minutes for each native editor after its URL opens. No provider-page modification, automatic reload behavior or protection bypass was added to the deployed application.

Phase 5 already verified real 50-word native rewriting and a completed detector score. Its 12-case final matrix and the earlier 11-case release authorization/administration suite remain documented in their original evidence. They were not rerun with expired acceptance grants or by resetting usage.

Final read-only monitoring verifies the original 60 PM2 PIDs/status/restart counts, the native release online with zero restarts, protected settings, persisted PM2 state, no operational secrets in its logs, the twelve native upstream references, and ordinary public responses. The ordinary-page comparison normalizes only the observed per-request SSR timestamp fields; status, byte size and all remaining content match.

## Operation and rollback

Assign an existing writer's email, daily feature limits and optional expiry in Phrasly Admin. Install the authenticated enabled extension ZIP once in the writer's Chrome/Edge browser. Visiting either entry then opens the corresponding native tool automatically.

The native provider account's plan allowance remains independent of TopRated's daily request limits. It last showed Free plan and 11 words left at 11:07 WAT. That amount was not remeasured during final acceptance. Continued processing needs an authorized Phrasly account with sufficient provider allowance; its cookie snapshot can be refreshed through the owner page.

The previous release and both routing snapshots are retained. Follow phase5-rollback.md. An initial native-release attempt restored the prior configuration automatically when raw HTML hashes differed; diagnosis showed existing SSR timestamps. The successful retry normalized only those timestamp fields and passed the strict comparisons.

No Business API, provider proxy, sales listing, order, payment, balance change, financial-table write, audit deletion or usage reset was introduced. Existing AWS request matching, cookie metadata, retry behavior, four-second timeout and attempt accounting remain intact. PR 109 records this release; deployment is independent of its merge status.
