# Phase 6 release progress

Status: DEPLOYED AND VERIFIED, including the customer-entry correction.

The actual customer dashboard and Phrasly tool page now expose the extension ZIP and installation steps. The existing Launch Phrasly button uses the AWS extension handoff and opens the authenticated native Humanizer; the tool page also opens the authenticated native Detector. A missing extension shows setup instead of the provider's login/signup page.

The full public customer run starting at 21:18 WAT passed all eight checks. Admin controls and the explicit installation guide also passed. Native startup delay is accounted for in acceptance.

Customer frontend source: 822809e8483d5d2fcfa11a02b1aaf843a14f8adc, seven public assets under /var/www/trst-phrasly-entry-20261026, activated at 21:05 WAT. The storefront and existing backend processes remain on ports 3124 and 3339 respectively. All 62 processes were unchanged during activation.

See phase6-closeout.md, customer-entry-correction.md and evidence/phase6-customer-entry-20261026.json for the verified state and rollback.
