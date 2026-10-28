# Customer Phrasly entry correction — 26 October 2026

Status: DEPLOYED AND VERIFIED on the actual customer path.

The previous Phase 6 verification covered /phrasly and missed the retained storefront's Launch Phrasly button and visible dashboard extension setup. The owner correctly identified that the normal button could still open the provider's unauthenticated website. The earlier complete claim did not cover the actual customer journey.

The correction adds Download Extension and explicit numbered Chrome/Edge/Brave installation instructions to /dashboard and /tools/phrasly. Downloading expands the steps. The existing Launch Phrasly button invokes the original AWS handoff. With no extension, it shows setup rather than opening a provider login/signup tab. With the downloaded extension installed, it opens the signed-in native Humanizer. The tool page's Detector button opens the signed-in native Detector. /phrasly?setup=1 provides a separate installation guide without opening provider tabs.

Frontend source: 822809e8483d5d2fcfa11a02b1aaf843a14f8adc. Activated at 21:05 WAT. Seven scanned public files are served from /var/www/trst-phrasly-entry-20261026. The storefront remains on port 3124 and the existing Phrasly backend remains on port 3339. No application process was restarted.

The full public customer run starting at 21:18 WAT passed all eight checks, covering real customer password login, missing-extension handling, visible instructions, exact enabled ZIP, dashboard placement, real catalog navigation and both authenticated native editors. Separate Admin and installation-guide checks passed. All three CI jobs on the frontend source passed. Detailed evidence is in evidence/phase6-customer-entry-20261026.json.

The test returns customer tabs to the foreground before catalog navigation; otherwise browser animation-frame throttling can produce a false timeout in a background tab. No SPA code workaround was added for that harness issue. Native startup can take time, as the owner confirmed for AWS; handoff and editor checks allow three minutes each.

The bootstrap is limited to Phrasly behavior, preserves the existing GA4 insertion and does not replace the storefront application. Original extension bodies, ZIP, encrypted account cookies, grants, attempts and financial records are unchanged. No generation was requested during these acceptance checks.

Latest routing backup: /home/ubuntu/backups/phrasly-entry-fix-20261026/nginx-before.conf. Restore /etc/nginx/sites-enabled/topratedseotools, validate nginx -t and reload if rollback is needed. No application restart or data rollback is required. Existing customer browser tabs need one refresh to receive the new integration.
