# Native Phrasly entry correction

Status: DEPLOYED AND VERIFIED, including the actual customer entry.

Writers use native phrasly.ai through the original AWS extension. The normal customer dashboard and Phrasly tool page now supply extension download and numbered installation steps, and the existing Launch Phrasly button opens the signed-in native Humanizer. The tool page also opens the signed-in native Detector. Missing-extension handling keeps users on installation guidance instead of opening provider login/signup. There is no first-party processing editor or cloned Phrasly dashboard.

The separate /phrasly auto-entry remains available; /phrasly?setup=1 opens its guide. Owner administration remains separate at /admin/phrasly.

Backend manifest source: 70e5c9be8a2c9ea691b39c779cfac9abe07058a2, PM2 trst-phrasly-native-oct26 on port 3339. Customer frontend source: 822809e8483d5d2fcfa11a02b1aaf843a14f8adc, public assets /var/www/trst-phrasly-entry-20261026.

The owner identified the earlier verification gap between the separate entry and the actual storefront. The full public customer run starting at 21:18 WAT now verifies login, download/setup, catalog navigation and both authenticated native editors. Native opening can take time, as on AWS. No provider behavior or original extension body was changed.

See phase6-closeout.md and customer-entry-correction.md for evidence, access links and rollback.
